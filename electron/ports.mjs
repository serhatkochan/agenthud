import { dirname, join, basename, win32 } from "node:path";
import { open } from "node:fs/promises";
import { agentFor, inventory } from "./system.mjs";
import { spawn } from "node:child_process";

const developer =
  /^(node|bun|deno|go|python[\d.]*|uvicorn|cargo|rust|dotnet|docker-proxy|php|ruby|java)(\.exe)?$/i;
function developerProcess(process, processes) {
  if (developer.test(process.Name)) return true;
  const visited = new Set([process.ProcessId]);
  let parent = process.ParentProcessId;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const current = processes.find((row) => row.ProcessId === parent);
    if (!current) break;
    if (/^(go|cargo|rustc)(\.exe)?$/i.test(current.Name)) return true;
    parent = current.ParentProcessId;
  }
  return false;
}
async function manifest(directory, name) {
  let file;
  try {
    file = await open(join(directory, name), "r");
    if ((await file.stat()).size > 1024 * 1024) return "";
    return await file.readFile("utf8");
  } catch {
    return "";
  } finally {
    await file?.close();
  }
}
async function projectName(directory, fallback) {
  const valid = (value) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !/[\x00-\x1f]/.test(value);
  try {
    const name = JSON.parse(await manifest(directory, "package.json")).name;
    if (valid(name)) return name;
  } catch {}
  const module = (await manifest(directory, "go.mod")).match(
    /^\s*module[\t ]+("(?:[^"\\\r\n]|\\.)+"|[^\s"/][^\s"]*)[\t ]*(?:\/\/[^\r\n]*)?\r?$/m,
  )?.[1];
  try {
    const name = module?.startsWith('"') ? JSON.parse(module) : module;
    if (valid(name)) return name;
  } catch {}
  return fallback;
}
export function projectHintDirectory(command = "") {
  const module = command.match(
    /([A-Za-z]:[\\/][^"\r\n]*?)[\\/]node_modules[\\/]/,
  );
  if (module) return module[1].replace(/^.*?([A-Za-z]:[\\/])/, "$1");
  const script = command.match(/"([A-Za-z]:[\\/][^"]+\.(?:js|mjs|cjs|py))"/);
  return script ? dirname(script[1]) : null;
}
export class PortManager {
  entries = new Map();
  launched = new Map();
  async scan(system) {
    const now = Date.now();
    const live = new Set();
    for (const listener of system.listeners) {
      if (listener.port < 1024) continue;
      const p = system.processes.find((x) => x.ProcessId === listener.pid);
      if (!p || p.ProcessId === process.pid) continue;
      const key = `${listener.port}:${p.ProcessId}`;
      const previous = [...this.entries.values()].find(
        (entry) =>
          entry.pid === p.ProcessId &&
          entry.identity &&
          entry.identity === p.CreationDate &&
          entry.command === p.CommandLine &&
          entry.executable === p.ExecutablePath,
      );
      const sameProcess = !!previous;
      const launched = this.launched.get(p.ProcessId);
      const ownLaunch =
        launched &&
        launched.child.exitCode === null &&
        launched.child.signalCode === null &&
        p.ExecutablePath?.toLowerCase() === launched.executable.toLowerCase();
      if (!developerProcess(p, system.processes) && !sameProcess && !ownLaunch)
        continue;
      const cwd =
        p.WorkingDirectory && win32.isAbsolute(p.WorkingDirectory)
          ? win32.resolve(p.WorkingDirectory)
          : null;
      if (cwd?.toLowerCase() === process.cwd().toLowerCase()) continue;
      live.add(key);
      const displayDirectory = cwd ?? projectHintDirectory(p.CommandLine);
      let project = displayDirectory
        ? basename(displayDirectory)
        : p.Name.replace(/\.exe$/i, "");
      if (displayDirectory)
        project = await projectName(displayDirectory, project);
      this.entries.set(key, {
        key,
        port: listener.port,
        pid: p.ProcessId,
        processName: p.Name,
        project,
        cwd,
        agent:
          agentFor(p, system.processes) ||
          (sameProcess ? previous.agent : null),
        status: "listening",
        orphan: !system.processes.some(
          (x) => x.ProcessId === p.ParentProcessId,
        ),
        seenAt: now,
        identity: p.CreationDate,
        executable: p.ExecutablePath,
        command: p.CommandLine,
      });
      if (ownLaunch) this.launched.delete(p.ProcessId);
    }
    for (const [key, e] of this.entries) {
      if (!live.has(key) && e.status === "listening") {
        e.status = "stopped";
        e.stoppedAt = now;
      }
      if (e.status === "stopped" && now - e.stoppedAt > 600000)
        this.entries.delete(key);
    }
    return this.publicEntries();
  }
  publicEntries() {
    return [...this.entries.values()]
      .map(
        ({
          key,
          port,
          pid,
          processName,
          project,
          agent,
          status,
          orphan,
          cwd,
        }) => ({
          key,
          port,
          pid,
          processName,
          project,
          agent,
          status,
          orphan,
          canRestart: !!cwd,
        }),
      )
      .sort((a, b) => a.port - b.port);
  }
  async stop(key) {
    const e = this.entries.get(key);
    if (!e || e.status !== "listening")
      throw new Error("Port artık açık değil. Listeyi yenile.");
    const current = (await inventory()).processes.find(
      (p) => p.ProcessId === e.pid,
    );
    if (
      !current ||
      current.CreationDate !== e.identity ||
      current.CommandLine !== e.command
    )
      throw new Error("Süreç değişmiş. Listeyi yenile ve yeniden dene.");
    if (e.pid === process.pid)
      throw new Error("Uygulamanın kendi süreci durdurulamaz.");
    e.cwd =
      current.WorkingDirectory && win32.isAbsolute(current.WorkingDirectory)
        ? win32.resolve(current.WorkingDirectory)
        : null;
    process.kill(e.pid);
    e.status = "stopped";
    e.stoppedAt = Date.now();
    return this.publicEntries();
  }
  restart(key) {
    const e = this.entries.get(key);
    if (
      !e ||
      e.status !== "stopped" ||
      !e.cwd ||
      !e.executable ||
      Date.now() - e.stoppedAt > 600000
    )
      throw new Error("Bu süreç için yeniden başlatma bilgisi bulunmuyor.");
    const tail = e.command.replace(/^\s*(?:"[^"]+"|\S+)\s*/, "");
    const child = spawn(e.executable, [tail], {
      argv0: `"${e.executable}"`,
      cwd: e.cwd,
      windowsHide: true,
      windowsVerbatimArguments: true,
      detached: true,
      stdio: "ignore",
    });
    return new Promise((resolve, reject) => {
      child.once("error", () =>
        reject(new Error("Süreç başlatılamadı. Proje klasörünü kontrol et.")),
      );
      child.once("spawn", () => {
        this.launched.set(child.pid, { child, executable: e.executable });
        child.once("exit", () => this.launched.delete(child.pid));
        child.unref();
        this.entries.delete(key);
        resolve(true);
      });
    });
  }
}
