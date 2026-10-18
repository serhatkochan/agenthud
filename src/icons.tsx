import type { CSSProperties } from "react";
type Kind =
  | "radar"
  | "ports"
  | "settings"
  | "refresh"
  | "arrow"
  | "pin"
  | "compact"
  | "close"
  | "minus"
  | "check"
  | "clock"
  | "link"
  | "bell"
  | "play"
  | "stop"
  | "expand"
  | "info";
const paths: Record<Kind, React.ReactNode> = {
  radar: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="m12 12 7-7" />
    </>
  ),
  ports: (
    <>
      <path d="M5 4v5m4-5v5M3 9h8v3a4 4 0 0 1-8 0Zm4 7v4h7a4 4 0 0 0 4-4v-3" />
      <path d="M15 9h6v4h-6zM18 6v3" />
    </>
  ),
  settings: (
    <>
      <path d="m10 3-1 3-3 1-2 3 2 2v4l3 1 1 3h4l1-3 3-1 2-3-2-2V7l-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2" />
    </>
  ),
  arrow: (
    <>
      <path d="M6 18 18 6M7 6h11v11" />
    </>
  ),
  pin: (
    <>
      <path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4ZM12 15v6" />
    </>
  ),
  compact: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="4" />
      <path d="M7 10h5m-5 4h10" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  link: (
    <>
      <path d="m10 8 2-2a5 5 0 0 1 7 7l-2 2M14 16l-2 2a5 5 0 0 1-7-7l2-2M8 16l8-8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3ZM10 21h4" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  expand: (
    <>
      <path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v6m0-10v.01" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: Kind;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
export function Brand({ id }: { id: string }) {
  if (id === "cursor")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path
          fill="currentColor"
          d="m16 2 12 7v14l-12 7-12-7V9Zm0 3L7 10l9 5 9-5Zm-10 7v10l9 5V17Zm11 5v10l9-5V12Z"
        />
        <path d="m10 13 12 7-4 1-2 5Z" fill="currentColor" />
      </svg>
    );
  if (id === "antigravity")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path fill="currentColor" d="M15 4h4l11 24h-7l-6-15-5 11H4Z" />
        <path d="m4 24 8-1 1 5H2Z" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <g stroke="currentColor" fill="none" strokeWidth="2">
        <path d="m16 3 11 6v13l-11 7-11-7V9Z" />
        <path d="m5 9 17 9v8M27 9 10 19v7M16 3v19l-11-7M27 15l-17-9M16 29V16l11 6" />
      </g>
    </svg>
  );
}
export function Mascot({
  mood = "idle",
  small = false,
}: {
  mood?: "idle" | "low";
  small?: boolean;
}) {
  return (
    <span
      className={`mascot ${small ? "small" : ""} ${mood}`}
      aria-hidden="true"
    >
      <span className="antenna" />
      <span className="mascot-face">
        <i />
        <i />
        <b />
      </span>
      <span className="mascot-foot" />
    </span>
  );
}
