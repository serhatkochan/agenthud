export type ProviderId = "cursor" | "antigravity" | "codex";
export interface Quota {
  id: string;
  label: string;
  remaining: number;
  resetsAt: string | null;
  group?: string;
  disabled?: boolean;
}
export interface Provider {
  id: ProviderId;
  name: string;
  description: string;
  url: string;
  status:
    "loading" | "connected" | "stale" | "needs-login" | "error" | "unavailable";
  quotas: Quota[];
  source?: string;
  plan?: string;
  message?: string;
  updatedAt?: number;
}
export interface Port {
  key: string;
  port: number;
  pid: number;
  processName: string;
  project: string;
  agent: ProviderId | null;
  status: "listening" | "stopped";
  orphan: boolean;
  canRestart: boolean;
}
export interface Settings {
  alwaysOnTop: boolean;
  refreshSeconds: number;
  notifications: boolean;
  clickThrough: boolean;
  launchCompact: boolean;
}
export interface Snapshot {
  providers: Provider[];
  ports: Port[];
  settings: Settings;
  mode: "dashboard" | "panel" | "compact";
  refreshing: boolean;
  systemError?: string;
  refreshedAt?: number;
  shortcutAvailable: boolean;
  recoveryShortcut?: string | null;
  ghostAvailable?: boolean;
  ghostPeeking?: boolean;
  ghostError?: string;
}
export interface Result {
  ok?: boolean;
  message?: string;
}
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  refresh(): Promise<Snapshot>;
  connect(id: ProviderId): Promise<Result>;
  openUsage(id: ProviderId): Promise<Result>;
  setSettings(patch: Partial<Settings>): Promise<Snapshot & Result>;
  window(action: string): Promise<Snapshot>;
  port(action: string, key: string): Promise<Result>;
  hotspot(
    rectangle: { x: number; y: number; width: number; height: number } | null,
  ): Promise<Result>;
  onUpdate(fn: (s: Snapshot) => void): () => void;
}
declare global {
  interface Window {
    agenthud?: Bridge;
  }
}
