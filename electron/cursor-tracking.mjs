import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { join, resolve, win32 } from "node:path";
import { randomUUID } from "node:crypto";

export const cursorEvents = [
  "sessionStart",
  "afterAgentThought",
  "afterAgentResponse",
  "stop",
  "sessionEnd",
];
const eventSet = new Set(cursorEvents);
const identifier = (value) =>
  typeof value === "string" && /^[\w.:-]{1,160}$/.test(value);
const rootPath = (value) =>
  typeof value === "string" &&
  value.length <= 1024 &&
  (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const filePattern = /^\d{8}T\d{13}Z-[a-f0-9]{32}\.json$/;
const commandPrefix =
  "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ";

function validatedEvent(value, now) {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !eventSet.has(value.event) ||
    !identifier(value.conversationId)
  )
    return null;
  if (value.generationId !== "" && !identifier(value.generationId)) return null;
  if (
    !["sessionStart", "sessionEnd"].includes(value.event) &&
    !identifier(value.generationId)
  )
    return null;
  const at = typeof value.at === "string" ? Date.parse(value.at) : NaN;
  if (!Number.isFinite(at) || at < now - 86400000 || at > now + 60000)
    return null;
  return {
    event: value.event,
    id: value.conversationId,
    generation: value.generationId,
    roots: Array.isArray(value.roots)
      ? value.roots.filter(rootPath).slice(0, 8)
      : [],
    at,
    status: ["completed", "aborted", "error"].includes(value.status)
      ? value.status
      : null,
    reason: [
      "completed",
      "aborted",
      "error",
      "window_close",
      "user_close",
    ].includes(value.reason)
      ? value.reason
      : null,
  };
}
function terminalState(event) {
  const result = event.event === "sessionEnd" ? event.reason : event.status;
  if (result === "completed")
    return { state: "done", statusLabel: "Tamamlandı" };
  if (["aborted", "window_close", "user_close"].includes(result))
    return {
      state: "idle",
      statusLabel: result === "aborted" ? "Durduruldu" : "Oturum kapandı",
    };
  return {
    state: "unknown",
    statusLabel: result === "error" ? "Hata ile durdu" : "Durum bilinmiyor",
  };
}
export function reduceCursorEvents(records, { now = Date.now() } = {}) {
  const conversations = new Map();
  for (const raw of records) {
    const event = validatedEvent(raw, now);
    if (!event) continue;
    const events = conversations.get(event.id) || [];
    events.push(event);
    conversations.set(event.id, events);
  }
  return [...conversations].map(([id, events]) => {
    events.sort((a, b) => a.at - b.at);
    const generations = new Map();
    for (const event of events) {
      if (
        !event.generation ||
        ["sessionStart", "sessionEnd"].includes(event.event)
      )
        continue;
      const group = generations.get(event.generation) || [];
      group.push(event);
      generations.set(event.generation, group);
    }
    const group =
      [...generations.values()].sort((a, b) => b[0].at - a[0].at)[0] || [];
    const latest = group.at(-1) || events.at(-1);
    const end = events
      .filter((e) => e.event === "sessionEnd" && e.at >= latest.at)
      .at(-1);
    const terminal = end || group.filter((e) => e.event === "stop").at(-1);
    let result = terminal
      ? terminalState(terminal)
      : group.length
        ? { state: "working" }
        : latest.event === "sessionEnd"
          ? terminalState(latest)
          : { state: "idle" };
    const updatedAt = Math.max(latest.at, terminal?.at || 0);
    if (result.state === "working" && now - updatedAt > 15 * 60000)
      result = { state: "unknown", statusLabel: "Yeni olay bekleniyor" };
    const cwd = [...events].reverse().flatMap((e) => e.roots)[0] || "";
    return {
      id: `cursor:${id}`,
      provider: "cursor",
      project: cwd ? win32.basename(cwd) : "Cursor oturumu",
      cwd,
      ...result,
      updatedAt,
      observedAt: now,
      source: "Cursor · oturum olayları",
    };
  });
}

export class CursorTracker {
  constructor({ directory }) {
    this.directory = resolve(directory);
    this.configPath = join(this.directory, "hooks.json");
    this.eventsDirectory = join(this.directory, "agenthud", "events");
    this.pending = null;
  }
  async command() {
    const script = await readFile(
      new URL("./observers/cursor.ps1", import.meta.url),
      "utf8",
    );
    const source = this.observerHeader() + script.replaceAll("\r\n", "\n");
    const command =
      commandPrefix + Buffer.from(source, "utf16le").toString("base64");
    if (command.length > 7800)
      throw new Error("Cursor profil yolu gözlemci için çok uzun.");
    return command;
  }
  observerHeader() {
    return `# AgentHUD Cursor observer v1\n$AgentHudDirectory='${this.eventsDirectory.replaceAll("'", "''")}'\n`;
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
        throw new Error("Cursor ayarları okunamadı; dosya değiştirilmedi.");
    }
    let config;
    try {
      config =
        raw === null
          ? { version: 1, hooks: {} }
          : JSON.parse(
              new TextDecoder("utf-8", { fatal: true })
                .decode(raw)
                .replace(/^\uFEFF/, ""),
            );
    } catch {
      throw new Error(
        "Cursor ayarlarında geçersiz JSON var; dosya değiştirilmedi.",
      );
    }
    if (
      !isRecord(config) ||
      config.version !== 1 ||
      !isRecord(config.hooks) ||
      Object.values(config.hooks).some((entries) => !Array.isArray(entries))
    )
      throw new Error(
        "Cursor ayarlarının biçimi desteklenmiyor; dosya değiştirilmedi.",
      );
    return { raw, config };
  }
  async status() {
    try {
      const [{ config }] = await Promise.all([this.config(), this.command()]);
      const count = cursorEvents.filter((event) =>
        config.hooks[event]?.some((entry) => this.owns(entry)),
      ).length;
      return {
        enabled: count === cursorEvents.length,
        status:
          count === 0
            ? "off"
            : count === cursorEvents.length
              ? "waiting"
              : "error",
        configPath: this.configPath,
        message:
          count > 0 && count < cursorEvents.length
            ? "Cursor takip bağlantısı eksik. Yeniden etkinleştirebilirsin."
            : undefined,
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
    for (const event of cursorEvents) {
      const previous = config.hooks[event] || [];
      const retained = previous.filter((entry) => !this.owns(entry));
      const next = enabled ? [...retained, { command, timeout: 3 }] : retained;
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        changed = true;
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
          "Cursor ayarları işlem sırasında değişti. Tekrar dene.",
        );
      if (raw !== null)
        await writeFile(
          join(
            this.directory,
            `hooks.agenthud-${Date.now()}-${randomUUID()}.bak`,
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
    if (!status.enabled) return { connection: status, sessions: [] };
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
          message: "Cursor olayları okunamadı.",
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
    const sessions = reduceCursorEvents(records);
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
