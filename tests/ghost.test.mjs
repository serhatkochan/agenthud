import test from "node:test";
import assert from "node:assert/strict";
import { GhostMode, registerRecoveryShortcut } from "../electron/ghost.mjs";

function fixture() {
  const state = {
    mode: "compact",
    visible: true,
    alt: false,
    point: { x: 210, y: 120 },
    ignored: false,
    calls: [],
    failed: false,
  };
  const ghost = new GhostMode({
    bounds: () => ({
      x: 100,
      y: 100,
      width: 420,
      height: state.mode === "compact" ? 48 : 720,
    }),
    mode: () => state.mode,
    visible: () => state.visible,
    cursor: () => state.point,
    altDown: () => state.alt,
    ignore: (value) => {
      state.ignored = value;
      state.calls.push(value);
    },
    show: (mode) => {
      state.mode = mode;
    },
    failed: () => {
      state.failed = true;
    },
  });
  ghost.setHotspot({ x: 8, y: 1, width: 48, height: 46 });
  return { ghost, state };
}
test("ghost mode passes through the quota area while its mascot remains clickable", () => {
  const { ghost, state } = fixture();
  ghost.enable();
  ghost.tick();
  assert.equal(state.ignored, true);
  state.point = { x: 130, y: 120 };
  ghost.tick();
  assert.equal(state.ignored, false);
  state.point = { x: 170, y: 120 };
  ghost.tick();
  assert.equal(state.ignored, true);
  ghost.disable();
  assert.equal(state.ignored, false);
});
test("Alt over the compact bar opens a temporary panel and releasing it restores the bar", () => {
  const { ghost, state } = fixture();
  ghost.enable();
  state.alt = true;
  ghost.tick();
  assert.equal(state.mode, "panel");
  assert.equal(state.ignored, false);
  state.alt = false;
  ghost.tick();
  assert.equal(state.mode, "compact");
  assert.equal(state.ignored, true);
});
test("Alt outside the HUD never opens it or intercepts another window", () => {
  const { ghost, state } = fixture();
  ghost.enable();
  state.point = { x: 0, y: 0 };
  state.alt = true;
  ghost.tick();
  assert.equal(state.mode, "compact");
  assert.equal(state.ignored, true);
});
test("temporary expansion restores the original bar anchor after a screen-edge clamp", () => {
  const original = { x: 100, y: 900, width: 420, height: 48 };
  let bounds = { ...original };
  let mode = "compact";
  let alt = true;
  let restored;
  const ghost = new GhostMode({
    bounds: () => bounds,
    mode: () => mode,
    visible: () => true,
    cursor: () => ({ x: 120, y: 920 }),
    altDown: () => alt,
    ignore: () => {},
    show: (next, anchor) => {
      mode = next;
      if (next === "panel")
        bounds = { x: 100, y: 300, width: 420, height: 720 };
      else restored = anchor;
    },
    failed: () => {},
  });
  ghost.enable();
  ghost.tick();
  alt = false;
  ghost.tick();
  assert.deepEqual(restored, original);
});
test("an explicitly opened panel stays interactive after Alt is released", () => {
  const { ghost, state } = fixture();
  ghost.enable();
  state.alt = true;
  ghost.tick();
  ghost.open("panel");
  state.alt = false;
  ghost.tick();
  assert.equal(state.mode, "panel");
  assert.equal(state.ignored, false);
  ghost.open("compact");
  ghost.tick();
  assert.equal(state.ignored, true);
});
test("normal view and native input failures restore mouse interaction", () => {
  const { ghost, state } = fixture();
  ghost.enable();
  ghost.open("dashboard");
  ghost.tick();
  assert.equal(state.ignored, false);
  assert.equal(ghost.enabled, false);
  const broken = new GhostMode({
    bounds: () => {
      throw new Error("unavailable");
    },
    mode: () => "compact",
    visible: () => true,
    cursor: () => state.point,
    altDown: () => false,
    ignore: (value) => (state.ignored = value),
    show: () => {},
    failed: () => (state.failed = true),
  });
  broken.enable();
  broken.tick();
  assert.equal(state.ignored, false);
  assert.equal(state.failed, true);
  assert.equal(broken.enabled, false);
});
test("invalid or oversized mascot rectangles cannot make the entire bar interactive", () => {
  const { ghost, state } = fixture();
  ghost.setHotspot({ x: 0, y: 0, width: 420, height: 48 });
  state.point = { x: 130, y: 120 };
  ghost.enable();
  ghost.tick();
  assert.equal(state.ignored, true);
  ghost.setHotspot({ x: 8, y: 1, width: 48, height: 46 });
  ghost.tick();
  assert.equal(state.ignored, false);
  ghost.setHotspot(null);
  ghost.tick();
  assert.equal(state.ignored, true);
});
test("a hidden HUD does not read keyboard or pointer state", () => {
  let reads = 0;
  let ignored;
  const ghost = new GhostMode({
    bounds: () => {},
    mode: () => "compact",
    visible: () => false,
    cursor: () => reads++,
    altDown: () => reads++,
    ignore: (value) => (ignored = value),
    show: () => {},
    failed: () => {},
  });
  ghost.enable();
  ghost.tick();
  assert.equal(reads, 0);
  assert.equal(ignored, false);
});
test("opening a view with ghost mode off explicitly restores native mouse input", () => {
  const { ghost, state } = fixture();
  state.ignored = true;
  ghost.open("compact");
  assert.equal(state.ignored, false);
});
test("an occupied recovery shortcut falls back and all occupied shortcuts stay unavailable", () => {
  const tried = [];
  assert.equal(
    registerRecoveryShortcut((key) => {
      tried.push(key);
      return tried.length === 2;
    }),
    "CommandOrControl+Alt+H",
  );
  assert.deepEqual(tried, [
    "CommandOrControl+Shift+H",
    "CommandOrControl+Alt+H",
  ]);
  assert.equal(
    registerRecoveryShortcut(() => false),
    null,
  );
});
