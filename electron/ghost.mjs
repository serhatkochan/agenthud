const contains = (point, rectangle) =>
  point.x >= rectangle.x &&
  point.y >= rectangle.y &&
  point.x < rectangle.x + rectangle.width &&
  point.y < rectangle.y + rectangle.height;

export class GhostMode {
  constructor(options) {
    this.options = options;
    this.enabled = false;
    this.peeking = false;
    this.peekAnchor = null;
    this.hotspot = null;
    this.ignored = undefined;
  }
  setHotspot(rectangle) {
    const valid =
      rectangle &&
      ["x", "y", "width", "height"].every(
        (key) =>
          typeof rectangle[key] === "number" && Number.isFinite(rectangle[key]),
      ) &&
      rectangle.x >= 0 &&
      rectangle.y >= 0 &&
      rectangle.width > 0 &&
      rectangle.width <= 80 &&
      rectangle.height > 0 &&
      rectangle.height <= 48 &&
      rectangle.x + rectangle.width <= 100 &&
      rectangle.y + rectangle.height <= 48;
    this.hotspot = valid
      ? {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
        }
      : null;
  }
  ignore(value) {
    if (value === this.ignored) return;
    this.options.ignore(value);
    this.ignored = value;
  }
  enable() {
    this.enabled = true;
    this.peeking = false;
  }
  disable() {
    this.enabled = false;
    this.peeking = false;
    this.peekAnchor = null;
    this.ignore(false);
  }
  open(mode) {
    this.peeking = false;
    this.peekAnchor = null;
    if (mode === "dashboard") this.disable();
    this.options.show(mode);
    if (!this.enabled) this.ignore(false);
    this.tick();
  }
  tick() {
    if (!this.enabled) return;
    try {
      if (!this.options.visible()) {
        this.ignore(false);
        return;
      }
      const alt = this.options.altDown();
      if (this.peeking && !alt) {
        this.peeking = false;
        this.options.show("compact", this.peekAnchor);
        this.peekAnchor = null;
      }
      if (this.options.mode() !== "compact") {
        this.ignore(false);
        return;
      }
      const bounds = this.options.bounds();
      const point = this.options.cursor();
      if (alt && contains(point, bounds)) {
        this.peeking = true;
        this.peekAnchor = { ...bounds };
        this.options.show("panel");
        this.ignore(false);
        return;
      }
      const local = { x: point.x - bounds.x, y: point.y - bounds.y };
      this.ignore(!this.hotspot || !contains(local, this.hotspot));
    } catch {
      this.disable();
      this.options.failed();
    }
  }
}

export function registerRecoveryShortcut(register) {
  for (const accelerator of [
    "CommandOrControl+Shift+H",
    "CommandOrControl+Alt+H",
    "CommandOrControl+Shift+G",
  ]) {
    if (register(accelerator)) return accelerator;
  }
  return null;
}
