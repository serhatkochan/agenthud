import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { readProcesses } from "./system.mjs";
import { loadWindowApi } from "./windows-focus.mjs";

const providers = {
  cursor: "cursor.exe",
  antigravity: "antigravity.exe",
  claude: "claude.exe",
  codex: "codex.exe",
};
const hosts = new Set([
  "windowsterminal.exe",
  "conhost.exe",
  "openconsole.exe",
  "powershell.exe",
  "pwsh.exe",
  "cmd.exe",
  "cursor.exe",
  "antigravity.exe",
  "code.exe",
]);
export function candidateProcesses(provider, processes) {
  if (!Object.hasOwn(providers, provider)) return [];
  const byId = new Map(
    processes.map((process) => [process.ProcessId, process]),
  );
  const selected = new Map();
  for (const process of processes.filter(
    (process) => process.Name?.toLowerCase() === providers[provider],
  )) {
    selected.set(process.ProcessId, process);
    const seen = new Set([process.ProcessId]);
    let parent = byId.get(process.ParentProcessId);
    while (parent && !seen.has(parent.ProcessId)) {
      seen.add(parent.ProcessId);
      if (hosts.has(parent.Name?.toLowerCase()))
        selected.set(parent.ProcessId, parent);
      parent = byId.get(parent.ParentProcessId);
    }
  }
  return [...selected.values()];
}
const normalize = (value) => value.normalize("NFC").trim();
function workspaceCaption(window) {
  const parts = window.title.split(/\s+[-—–|·]\s+/).map(normalize);
  const brand = parts.at(-1)?.toLowerCase();
  if (
    !["cursor", "antigravity", "visual studio code"].includes(brand) ||
    parts.length < 2
  )
    return null;
  return parts
    .at(-2)
    .replace(/^●\s*/, "")
    .replace(/\s+\(Workspace\)$/i, "");
}
function projectMatches(session, window) {
  if (!session.cwd) return false;
  const caption = workspaceCaption(window);
  if (!caption) return false;
  if (normalize(caption) === normalize(win32.basename(session.cwd)))
    return true;
  if (/^[a-z]:[\\/]/i.test(caption))
    return (
      win32.normalize(caption).toLowerCase() ===
      win32.normalize(session.cwd).toLowerCase()
    );
  return false;
}
export function chooseWindow(session, windows) {
  const matches = windows.filter((window) => projectMatches(session, window));
  if (matches.length === 1) return { target: matches[0], scope: "project" };
  if (matches.length > 1) return { choices: matches };
  if (windows.length === 1) return { target: windows[0], scope: "application" };
  return { choices: windows };
}
export function sameProcessBirth(left, right) {
  const valid = (value) =>
    typeof value === "string" && /^\d{1,20}$/.test(value);
  return (
    valid(left) && valid(right) && BigInt(left) / 10n === BigInt(right) / 10n
  );
}
async function listForSession(session) {
  const processes = candidateProcesses(session.provider, await readProcesses());
  const byId = new Map(
    processes.map((process) => [process.ProcessId, process]),
  );
  return loadWindowApi()
    .list(new Set(byId.keys()))
    .filter((window) =>
      sameProcessBirth(byId.get(window.pid)?.CreationId, window.creationId),
    )
    .map((window) => ({
      ...window,
      app: byId.get(window.pid).Name.replace(/\.exe$/i, ""),
    }));
}
const context = (session) => `${session.provider}\0${session.cwd}`;
export class FocusService {
  constructor({
    list = listForSession,
    focus = (target) => loadWindowApi().focus(target),
    now = Date.now,
  } = {}) {
    this.list = list;
    this.focus = focus;
    this.now = now;
    this.pending = new Map();
  }
  async request(session, choiceId) {
    try {
      for (const [id, request] of this.pending)
        if (this.now() - request.created > 60000) this.pending.delete(id);
      if (choiceId) {
        const request = this.pending.get(session.id);
        const target =
          request?.context === context(session)
            ? request.targets.get(choiceId)
            : null;
        if (!target)
          return {
            ok: false,
            message: "Pencere seçimi artık güncel değil. Listeyi yenile.",
          };
        return await this.activate(target, "selected");
      }
      const selection = chooseWindow(session, await this.list(session));
      if (selection.target)
        return await this.activate(selection.target, selection.scope);
      if (!selection.choices.length)
        return {
          ok: false,
          message: "Bu oturuma ait açık bir uygulama penceresi bulunamadı.",
        };
      const targets = new Map(
        selection.choices.map((window) => [randomUUID(), window]),
      );
      this.pending.set(session.id, {
        created: this.now(),
        context: context(session),
        targets,
      });
      return {
        ok: true,
        choices: [...targets].map(([id, window]) => ({
          id,
          title: window.title,
          app: window.app,
        })),
      };
    } catch {
      return { ok: false, message: "Pencere bilgisi okunamadı. Yeniden dene." };
    }
  }
  async activate(target, scope) {
    const result = await this.focus(target);
    if (result === "focused") return { ok: true, scope };
    return {
      ok: false,
      message:
        result === "stale"
          ? "Seçilen pencere değişmiş veya kapanmış. Listeyi yenile."
          : "Pencere öne getirilemedi. Görev çubuğundan açabilirsin.",
    };
  }
}
