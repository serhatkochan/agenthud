import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function powershell(script, timeout = 18000) {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; " +
          script,
        "utf16le",
      ).toString("base64"),
    ],
    {
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    },
  );
  return stdout.trim();
}
export function parseNetstat(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = line
      .trim()
      .match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
    return m ? [{ address: m[1], port: Number(m[2]), pid: Number(m[3]) }] : [];
  });
}
export async function inventory() {
  if (process.platform !== "win32") return { processes: [], listeners: [] };
  const [json, netstat] = await Promise.all([
    powershell(
      '$sid=(Get-Process -Id $PID).SessionId; @(Get-CimInstance Win32_Process -Filter "SessionId=$sid" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,CreationDate) | ConvertTo-Json -Compress -Depth 3',
    ),
    exec("netstat.exe", ["-ano", "-p", "tcp"], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    }),
  ]);
  return {
    processes: JSON.parse(json || "[]"),
    listeners: parseNetstat(netstat.stdout),
  };
}
export function flag(command, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    command
      ?.match(
        new RegExp(`--${escaped}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\s]+))`),
      )
      ?.slice(1)
      .find(Boolean) ?? null
  );
}
export function agentFor(p, processes) {
  const seen = new Set();
  while (p && !seen.has(p.ProcessId)) {
    seen.add(p.ProcessId);
    if (/cursor/i.test(p.Name)) return "cursor";
    if (/antigravity/i.test(p.Name)) return "antigravity";
    if (/claude/i.test(p.Name)) return "claude";
    if (/codex/i.test(p.Name)) return "codex";
    p = processes.find((x) => x.ProcessId === p.ParentProcessId);
  }
  return null;
}
