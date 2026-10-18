import { readdir, stat, open } from "node:fs/promises";
import { join, basename } from "node:path";
import { powershell } from "./system.mjs";

async function latestFiles(root, depth) {
  if (depth < 0) return [];
  let items;
  try {
    items = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  let files = [];
  for (const e of items) {
    const path = join(root, e.name);
    if (e.isDirectory()) files.push(...(await latestFiles(path, depth - 1)));
    else if (e.name.endsWith(".jsonl")) {
      const s = await stat(path);
      files.push({ path, time: s.mtimeMs });
    }
  }
  return files.sort((a, b) => b.time - a.time).slice(0, 8);
}
async function edges(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const first = Buffer.alloc(Math.min(size, 1024 * 1024));
    await file.read(first, 0, first.length, 0);
    const last = Buffer.alloc(Math.min(size, 128 * 1024));
    await file.read(last, 0, last.length, Math.max(0, size - last.length));
    return [
      ...first.toString().split("\n").slice(0, 1),
      ...last.toString().split("\n"),
    ].flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } finally {
    await file.close();
  }
}
export function codexState(events) {
  let state = "unknown";
  let cwd = "";
  let updatedAt = 0;
  for (const e of events) {
    if (e.type === "session_meta") cwd = e.payload?.cwd || cwd;
    if (e.type !== "event_msg") continue;
    const type = e.payload?.type;
    if (type === "task_started") state = "working";
    if (["task_complete", "turn_complete"].includes(type)) state = "done";
    if (["approval_request", "exec_approval_request"].includes(type))
      state = "blocked";
    if (type === "turn_aborted") state = "idle";
    if (
      [
        "task_started",
        "task_complete",
        "turn_complete",
        "approval_request",
        "exec_approval_request",
        "turn_aborted",
      ].includes(type)
    )
      updatedAt = Date.parse(e.timestamp) || 0;
  }
  if (state === "working" && Date.now() - updatedAt > 15 * 60000)
    state = "unknown";
  return { state, cwd, updatedAt };
}
export async function readSessions(system) {
  const result = [];
  const files = await latestFiles(
    join(
      process.env.CODEX_HOME || join(process.env.USERPROFILE, ".codex"),
      "sessions",
      ...new Date().toISOString().slice(0, 10).split("-"),
    ),
    0,
  );
  for (const file of files) {
    if (Date.now() - file.time > 24 * 3600000) continue;
    try {
      const s = codexState(await edges(file.path));
      if (!s.cwd) continue;
      result.push({
        id: file.path,
        provider: "codex",
        project: basename(s.cwd),
        ...s,
      });
    } catch {}
  }
  for (const [provider, name] of [
    ["cursor", "Cursor.exe"],
    ["antigravity", "Antigravity.exe"],
    ["claude", "claude.exe"],
  ]) {
    const running = system.processes.some(
      (x) => x.Name.toLowerCase() === name.toLowerCase(),
    );
    if (running)
      result.push({
        id: provider,
        provider,
        project: "Uygulama açık",
        state: "unknown",
        cwd: "",
        updatedAt: 0,
      });
  }
  return result.slice(0, 10);
}
export async function focusProvider(provider) {
  const names = {
    cursor: "Cursor",
    antigravity: "Antigravity",
    claude: "Claude",
    codex: "Codex",
  };
  const name = names[provider];
  if (!name) throw new Error("Uygulama bulunamadı.");
  const output = await powershell(
    `$p=Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if(!$p){throw 'missing'}; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HudFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'; [HudFocus]::ShowWindow($p.MainWindowHandle,9) | Out-Null; [HudFocus]::SetForegroundWindow($p.MainWindowHandle)`,
  );
  if (output !== "True")
    throw new Error("Pencere öne getirilemedi. Görev çubuğundan açabilirsin.");
}
