export function windowLayout({
  mode,
  previousMode,
  previous,
  work,
  peekAnchor,
}) {
  const preferred =
    mode === "compact"
      ? [420, 48]
      : mode === "panel"
        ? [420, 720]
        : [1120, 940];
  const size = [
    Math.min(preferred[0], work.width),
    Math.min(preferred[1], work.height),
  ];
  const minimum = [
    Math.min(mode === "dashboard" ? 760 : 380, work.width),
    Math.min(mode === "compact" ? 48 : 540, work.height),
  ];
  let x = previous.x,
    y = previous.y;
  if (mode !== "dashboard") {
    if (peekAnchor) {
      x = peekAnchor.x;
      y = peekAnchor.y;
    } else if (previousMode === "dashboard") {
      x = work.x + work.width - size[0] - 24;
      y = work.y + 24;
    } else x = previous.x + previous.width - size[0];
  }
  return {
    size,
    minimum,
    position: [
      Math.max(work.x, Math.min(x, work.x + work.width - size[0])),
      Math.max(work.y, Math.min(y, work.y + work.height - size[1])),
    ],
  };
}
