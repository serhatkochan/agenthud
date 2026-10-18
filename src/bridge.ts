import type { Bridge, Snapshot } from "./types";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
const names = ["Cursor", "Antigravity", "Codex"];
const ids = ["cursor", "antigravity", "codex"] as const;
const preview: Snapshot = {
  providers: ids.map((id, i) => ({
    id,
    name: names[i],
    description: [
      "Cursor Models & Other Models",
      "Model grupları & kullanım pencereleri",
      "ChatGPT plan limitleri",
    ][i],
    url: "",
    status: "unavailable",
    quotas: [],
    message: "Gerçek kullanım bilgileri masaüstü uygulamasında gösterilir.",
  })),
  ports: [],
  sessions: [],
  mode: "dashboard",
  refreshing: false,
  shortcutAvailable: false,
  cursorTracking: { enabled: false, status: "off", configPath: "" },
  settings: {
    alwaysOnTop: false,
    refreshSeconds: 60,
    notifications: true,
    clickThrough: false,
    launchCompact: false,
  },
};
const unavailable = async () => ({
  ok: false,
  message: "Bu işlem masaüstü uygulamasında kullanılabilir.",
});
export const isDesktop = isTauri();
const desktop: Bridge = {
  snapshot: () => invoke("snapshot"),
  refresh: () => invoke("refresh"),
  connect: (id) => invoke("connect_provider", { id }),
  openUsage: (id) => invoke("open_usage", { id }),
  setSettings: (patch) => invoke("set_settings", { patch }),
  window: (action) => invoke("window_action", { action }),
  port: (action, key) => invoke("port_action", { action, key }),
  focus: (sessionId, choiceId) =>
    invoke("focus_session", { sessionId, choiceId: choiceId ?? null }),
  hotspot: (rectangle) => invoke("set_hotspot", { rectangle }),
  tracking: (provider, enabled) =>
    invoke("set_tracking", { provider, enabled }),
  onUpdate: (fn) => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<Snapshot>("hud:update", ({ payload }) => fn(payload)).then(
      (unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      },
    );
    return () => {
      disposed = true;
      stop?.();
    };
  },
};
export const bridge: Bridge = isDesktop
  ? desktop
  : {
      snapshot: async () => preview,
      refresh: async () => preview,
      connect: unavailable,
      openUsage: unavailable,
      setSettings: async (patch) => ({
        ...preview,
        settings: { ...preview.settings, ...patch },
      }),
      window: async (mode) => ({ ...preview, mode: mode as Snapshot["mode"] }),
      port: unavailable,
      focus: unavailable,
      hotspot: unavailable,
      tracking: unavailable,
      onUpdate: () => () => {},
    };
if (isDesktop) {
  window.agenthud = bridge;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      event.button === 0 &&
      target instanceof Element &&
      target.closest(".titlebar, .compact-bar") &&
      !target.closest("button,a,input,select,summary")
    )
      void bridge.window("drag").catch(() => {});
  });
}
