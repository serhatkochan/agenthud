import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
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
export async function inventory({
  workingDirectories = true,
  agentsOnly = false,
} = {}) {
  if (process.platform !== "win32") return { processes: [], listeners: [] };
  const filter = agentsOnly
    ? " AND (Name='Cursor.exe' OR Name='Antigravity.exe' OR Name='claude.exe' OR Name='Codex.exe' OR Name LIKE 'language%server%')"
    : "";
  const [json, netstat] = await Promise.all([
    powershell(
      `$sid=(Get-Process -Id $PID).SessionId; @(Get-CimInstance Win32_Process -Filter "SessionId=$sid${filter}" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,CreationDate,@{Name="CreationId";Expression={$_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)}}) | ConvertTo-Json -Compress -Depth 3`,
    ),
    exec("netstat.exe", ["-ano", "-p", "tcp"], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    }),
  ]);
  const decoded = JSON.parse(json || "[]");
  const processes = Array.isArray(decoded) ? decoded : decoded ? [decoded] : [];
  const listeners = parseNetstat(netstat.stdout);
  if (!workingDirectories) return { processes, listeners };
  const candidates = processes.filter(
    (p) =>
      listeners.some((l) => l.pid === p.ProcessId) &&
      /^(node|bun|deno|go|python[\d.]*|uvicorn|cargo|rust|dotnet|docker-proxy|php|ruby|java)(\.exe)?$/i.test(
        p.Name,
      ),
  );
  let directories = [];
  try {
    directories = await readWorkingDirectories(
      candidates.map((p) => p.ProcessId),
    );
  } catch {}
  return {
    processes: attachWorkingDirectories(processes, directories),
    listeners,
  };
}
export function attachWorkingDirectories(processes, directories) {
  // WMI truncates creation times to microseconds; GetProcessTimes retains 100 ns ticks.
  const micros = (id) =>
    typeof id === "string" && /^\d{1,20}$/.test(id) ? BigInt(id) / 10n : null;
  return processes.map((p) => {
    const created = micros(p.CreationId);
    const match =
      created === null
        ? null
        : directories.find(
            (d) =>
              d.ProcessId === p.ProcessId && micros(d.CreationId) === created,
          );
    return { ...p, WorkingDirectory: match?.WorkingDirectory ?? null };
  });
}
export async function readWorkingDirectories(pids) {
  const ids = [...new Set(pids)]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, 128);
  if (process.platform !== "win32" || !ids.length) return [];
  const source = await readFile(
    new URL("./native/ProcessDirectory.cs", import.meta.url),
    "utf8",
  );
  const result = await powershell(
    `Add-Type -TypeDefinition @'\n${source}\n'@; $processIds=@(${ids.join(",")}); @($processIds | ForEach-Object { [HudProcessDirectory]::ReadDirectory([int]$_) } | Where-Object { $null -ne $_ }) | ConvertTo-Json -Compress -Depth 3`,
  );
  const decoded = JSON.parse(result || "[]");
  return Array.isArray(decoded) ? decoded : decoded ? [decoded] : [];
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
