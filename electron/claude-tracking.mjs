import { win32 } from "node:path";
import { HookTracker } from "./hook-tracker.mjs";

export const claudeEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
];
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const absolutePath = (value) =>
  typeof value === "string" &&
  value.length <= 1024 &&
  (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));

export function reduceClaudeEvents(records, { now = Date.now() } = {}) {
  const sessions = new Map();
  for (const record of records) {
    if (
      !isRecord(record) ||
      record.version !== 1 ||
      !claudeEvents.includes(record.event) ||
      typeof record.sessionId !== "string" ||
      !/^[\w.:-]{1,160}$/.test(record.sessionId) ||
      record.agentId
    )
      continue;
    const at = typeof record.at === "string" ? Date.parse(record.at) : NaN;
    if (!Number.isFinite(at) || at < now - 86400000 || at > now + 60000)
      continue;
    let state, statusLabel;
    switch (record.event) {
      case "SessionStart":
        state = "idle";
        break;
      case "UserPromptSubmit":
        state = "working";
        statusLabel = "İstek gönderildi";
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        state = "working";
        break;
      case "Notification":
        if (record.notificationType === "permission_prompt") {
          state = "blocked";
          statusLabel = "Onay bekliyor";
        } else if (record.notificationType === "idle_prompt") {
          state = "idle";
        } else continue;
        break;
      case "Stop":
        state = record.background === true ? "working" : "done";
        statusLabel =
          record.background === true
            ? "Arka plan işi sürüyor"
            : "Yanıt tamamlandı";
        break;
      case "StopFailure":
        state = "unknown";
        statusLabel = "Hata ile durdu";
        break;
      case "SessionEnd":
        state = "idle";
        statusLabel = "Oturum kapandı";
        break;
    }
    const prior = sessions.get(record.sessionId);
    if (prior && prior.updatedAt > at) continue;
    const cwd = absolutePath(record.cwd) ? record.cwd : prior?.cwd || "";
    sessions.set(record.sessionId, {
      id: `claude:${record.sessionId}`,
      provider: "claude",
      cwd,
      project: cwd ? win32.basename(cwd) : "Claude Code oturumu",
      state,
      statusLabel,
      updatedAt: at,
      observedAt: now,
      source: "Claude Code · oturum olayları",
    });
  }
  return [...sessions.values()].map((session) =>
    ["working", "blocked"].includes(session.state) &&
    now - session.updatedAt > 15 * 60000
      ? { ...session, state: "unknown", statusLabel: "Yeni olay bekleniyor" }
      : session,
  );
}

export class ClaudeTracker extends HookTracker {
  constructor({ directory }) {
    super({
      directory,
      name: "Claude Code",
      configName: "settings.json",
      scriptName: "claude",
      events: claudeEvents,
      reduce: reduceClaudeEvents,
    });
  }
  defaultConfig() {
    return {};
  }
  validateConfig(config) {
    return (
      isRecord(config) &&
      (config.hooks === undefined ||
        (isRecord(config.hooks) &&
          Object.values(config.hooks).every(
            (groups) =>
              Array.isArray(groups) &&
              groups.every(
                (group) => isRecord(group) && Array.isArray(group.hooks),
              ),
          )))
    );
  }
  entries(config, event) {
    return (config.hooks?.[event] || []).flatMap((group) => group.hooks);
  }
  patch(previous, event, command) {
    const retained = previous.flatMap((group) => {
      const hooks = group.hooks.filter((entry) => !this.owns(entry));
      return hooks.length === group.hooks.length
        ? [group]
        : hooks.length
          ? [{ ...group, hooks }]
          : [];
    });
    return command
      ? [
          ...retained,
          {
            ...(event === "Notification"
              ? { matcher: "permission_prompt|idle_prompt" }
              : {}),
            hooks: [{ type: "command", command, timeout: 3 }],
          },
        ]
      : retained;
  }
  connectionProblem(config) {
    return config.disableAllHooks === true
      ? "Claude Code’da tüm olay bağlantıları kapalı. Kendi ayarlarından açabilirsin; AgentHUD bu tercihi değiştirmez."
      : undefined;
  }
}
