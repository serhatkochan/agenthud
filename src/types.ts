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
export interface AgentSession {
  id: string;
  provider: ProviderId;
  project: string;
  state: "working" | "done" | "blocked" | "idle" | "unknown";
  cwd: string;
  updatedAt: number;
  source?: string;
  statusLabel?: string;
  observedAt?: number;
  stale?: boolean;
}
export interface Settings {
  alwaysOnTop: boolean;
  refreshSeconds: number;
  notifications: boolean;
  clickThrough: boolean;
  launchCompact: boolean;
}
export interface TrackingConnection {
  enabled: boolean;
  status: "loading" | "off" | "waiting" | "active" | "error";
  configPath: string;
  message?: string;
  lastEventAt?: number;
}
export interface Snapshot {
  providers: Provider[];
  ports: Port[];
  sessions: AgentSession[];
  settings: Settings;
  mode: "dashboard" | "panel" | "compact";
  refreshing: boolean;
  systemError?: string;
  refreshedAt?: number;
  shortcutAvailable: boolean;
  sessionsUpdatedAt?: number;
  sessionsError?: string;
  recoveryShortcut?: string | null;
  ghostAvailable?: boolean;
  ghostPeeking?: boolean;
  ghostError?: string;
  cursorTracking: TrackingConnection;
}
export interface Result {
  ok?: boolean;
  message?: string;
}
export interface FocusChoice {
  id: string;
  title: string;
  app: string;
}
export interface FocusResult extends Result {
  choices?: FocusChoice[];
  scope?: "project" | "application" | "selected";
}
export interface Bridge {
  snapshot(): Promise<Snapshot>;
  refresh(): Promise<Snapshot>;
  connect(id: ProviderId): Promise<Result>;
  openUsage(id: ProviderId): Promise<Result>;
  setSettings(patch: Partial<Settings>): Promise<Snapshot & Result>;
  window(action: string): Promise<Snapshot>;
  port(action: string, key: string): Promise<Result>;
  focus(sessionId: string, choiceId?: string): Promise<FocusResult>;
  tracking(provider: "cursor", enabled: boolean): Promise<Result>;
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
