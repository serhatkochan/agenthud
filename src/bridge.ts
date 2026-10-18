import type { Bridge, Snapshot } from "./types";
const names = ["Cursor", "Antigravity", "Claude", "Codex"];
const ids = ["cursor", "antigravity", "claude", "codex"] as const;
const preview: Snapshot = {
  providers: ids.map((id, i) => ({
    id,
    name: names[i],
    description: [
      "Cursor Models & Other Models",
      "Model grupları & kullanım pencereleri",
      "Oturum & haftalık kullanım",
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
export const isDesktop = !!window.agenthud;
export const bridge: Bridge = window.agenthud ?? {
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
