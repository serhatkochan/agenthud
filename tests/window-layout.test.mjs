import test from "node:test";
import assert from "node:assert/strict";
import { windowLayout } from "../electron/window-layout.mjs";

test("expanding a top-right compact HUD keeps the full dashboard inside the same display", () => {
  const layout = windowLayout({
    mode: "dashboard",
    previousMode: "compact",
    previous: { x: 2116, y: 24, width: 420, height: 48 },
    work: { x: 0, y: 0, width: 2560, height: 1392 },
  });
  assert.deepEqual(layout, {
    size: [1120, 940],
    minimum: [760, 540],
    position: [1440, 24],
  });
});
test("a small work area limits native size and minimum size so the HUD remains reachable", () => {
  const layout = windowLayout({
    mode: "dashboard",
    previousMode: "compact",
    previous: { x: 700, y: 10, width: 420, height: 48 },
    work: { x: 0, y: 0, width: 900, height: 500 },
  });
  assert.deepEqual(layout, {
    size: [900, 500],
    minimum: [760, 500],
    position: [0, 0],
  });
});
test("floating views retain their display and temporary peeks return to their original anchor", () => {
  const work = { x: -1920, y: 0, width: 1920, height: 1040 };
  const panel = windowLayout({
    mode: "panel",
    previousMode: "compact",
    previous: { x: -450, y: 970, width: 420, height: 48 },
    work,
  });
  assert.deepEqual(panel.position, [-450, 320]);
  const compact = windowLayout({
    mode: "compact",
    previousMode: "panel",
    previous: { x: -450, y: 320, width: 420, height: 720 },
    work,
    peekAnchor: { x: -450, y: 970, width: 420, height: 48 },
  });
  assert.deepEqual(compact.position, [-450, 970]);
});
