import { win32 } from "node:path";
import { HookTracker } from "./hook-tracker.mjs";

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

export class CursorTracker extends HookTracker {
  constructor({ directory }) {
    super({
      directory,
      name: "Cursor",
      configName: "hooks.json",
      scriptName: "cursor",
      events: cursorEvents,
      reduce: reduceCursorEvents,
    });
  }
  defaultConfig() {
    return { version: 1, hooks: {} };
  }
  validateConfig(config) {
    return (
      isRecord(config) &&
      config.version === 1 &&
      isRecord(config.hooks) &&
      Object.values(config.hooks).every(Array.isArray)
    );
  }
  entries(config, event) {
    return config.hooks[event] || [];
  }
  patch(previous, event, command) {
    const retained = previous.filter((entry) => !this.owns(entry));
    return command ? [...retained, { command, timeout: 3 }] : retained;
  }
}
