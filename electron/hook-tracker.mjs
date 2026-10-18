import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const filePattern = /^\d{8}T\d{13}Z-[a-f0-9]{32}\.json$/;
const commandPrefix =
  "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ";

export class HookTracker {
  constructor({ directory, name, configName, scriptName, events, reduce }) {
    this.name = name;
    this.events = events;
    this.reduce = reduce;
    this.scriptName = scriptName;
    this.configName = configName;
    this.directory = resolve(directory);
    this.configPath = join(this.directory, configName);
    this.eventsDirectory = join(this.directory, "agenthud", "events");
    this.pending = null;
  }
  async command() {
    const script = await readFile(
      new URL(`./observers/${this.scriptName}.ps1`, import.meta.url),
      "utf8",
    );
    const source = this.observerHeader() + script.replaceAll("\r\n", "\n");
    const command =
      commandPrefix + Buffer.from(source, "utf16le").toString("base64");
    if (command.length > 7800)
      throw new Error(`${this.name} profil yolu gözlemci için çok uzun.`);
    return command;
  }
  observerHeader() {
    return `# AgentHUD ${this.name} observer v1\n$AgentHudDirectory='${this.eventsDirectory.replaceAll("'", "''")}'\n`;
  }
  owns(entry) {
    if (
      !isRecord(entry) ||
      typeof entry.command !== "string" ||
      entry.command.length > 7800 ||
      !entry.command.startsWith(commandPrefix)
    )
      return false;
    const encoded = entry.command.slice(commandPrefix.length);
    return (
      /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
      Buffer.from(encoded, "base64")
        .toString("utf16le")
        .startsWith(this.observerHeader())
    );
  }
  async config() {
    let raw = null;
    try {
      const file = await open(this.configPath, "r");
      try {
        const { size } = await file.stat();
        if (size > 1024 * 1024) throw new Error("large");
        raw = await file.readFile();
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          `${this.name} ayarları okunamadı; dosya değiştirilmedi.`,
        );
    }
    let config;
    try {
      config =
        raw === null
          ? this.defaultConfig()
          : JSON.parse(
              new TextDecoder("utf-8", { fatal: true })
                .decode(raw)
                .replace(/^\uFEFF/, ""),
            );
    } catch {
      throw new Error(
        `${this.name} ayarlarında geçersiz JSON var; dosya değiştirilmedi.`,
      );
    }
    if (!this.validateConfig(config))
      throw new Error(
        `${this.name} ayarlarının biçimi desteklenmiyor; dosya değiştirilmedi.`,
      );
    return { raw, config };
  }
  async status() {
    try {
      const [{ config }] = await Promise.all([this.config(), this.command()]);
      const count = this.events.filter((event) =>
        this.entries(config, event).some((entry) => this.owns(entry)),
      ).length;
      const problem = this.connectionProblem?.(config);
      return {
        enabled: count === this.events.length,
        status: problem
          ? "error"
          : count === 0
            ? "off"
            : count === this.events.length
              ? "waiting"
              : "error",
        configPath: this.configPath,
        message:
          problem ||
          (count > 0 && count < this.events.length
            ? `${this.name} takip bağlantısı eksik. Yeniden etkinleştirebilirsin.`
            : undefined),
      };
    } catch (error) {
      return {
        enabled: false,
        status: "error",
        configPath: this.configPath,
        message: error.message,
      };
    }
  }
  async setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Geçersiz takip ayarı.");
    const operation = (this.pending || Promise.resolve())
      .catch(() => {})
      .then(() => this.update(enabled));
    this.pending = operation;
    return operation.finally(() => {
      if (this.pending === operation) this.pending = null;
    });
  }
  async update(enabled) {
    const [{ raw, config }, command] = await Promise.all([
      this.config(),
      this.command(),
    ]);
    let changed = false;
    for (const event of this.events) {
      const previous = config.hooks?.[event] || [];
      const next = this.patch(previous, event, enabled ? command : null);
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        changed = true;
        config.hooks ||= {};
        config.hooks[event] = next;
      }
    }
    if (!changed) return this.status();
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.agenthud-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
      const current = await readFile(this.configPath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (
        !(current === null && raw === null) &&
        !(current && raw && current.equals(raw))
      )
        throw new Error(
          `${this.name} ayarları işlem sırasında değişti. Tekrar dene.`,
        );
      if (raw !== null)
        await writeFile(
          join(
            this.directory,
            `${this.configName.replace(/\.json$/, "")}.agenthud-${Date.now()}-${randomUUID()}.bak`,
          ),
          raw,
          { encoding: "utf8", flag: "wx" },
        );
      await rename(temporary, this.configPath);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return this.status();
  }
  async readSessions() {
    const status = await this.status();
    if (!status.enabled || status.status === "error")
      return { connection: status, sessions: [] };
    let files;
    try {
      files = (await readdir(this.eventsDirectory))
        .filter((name) => filePattern.test(name))
        .sort()
        .reverse()
        .slice(0, 4096);
    } catch (error) {
      if (error.code === "ENOENT") return { connection: status, sessions: [] };
      return {
        connection: {
          ...status,
          status: "error",
          message: `${this.name} olayları okunamadı.`,
        },
        sessions: [],
      };
    }
    const records = [];
    for (let index = 0; index < files.length; index += 64) {
      const batch = await Promise.all(
        files.slice(index, index + 64).map(async (name) => {
          let file;
          try {
            file = await open(join(this.eventsDirectory, name), "r");
            const buffer = Buffer.alloc(65537);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            return bytesRead <= 65536
              ? JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))
              : null;
          } catch {
            return null;
          } finally {
            await file?.close().catch(() => {});
          }
        }),
      );
      records.push(...batch);
    }
    const sessions = this.reduce(records);
    const lastEventAt = sessions.length
      ? Math.max(...sessions.map((row) => row.updatedAt))
      : undefined;
    return {
      connection: {
        ...status,
        status: lastEventAt ? "active" : "waiting",
        lastEventAt,
      },
      sessions,
    };
  }
}
