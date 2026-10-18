import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const profile = join(process.cwd(), ".cache", "ghost-profile");
await mkdir(profile, { recursive: true });
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    alwaysOnTop: true,
    notifications: false,
    refreshSeconds: 300,
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath:
    process.argv[2] ||
    join(process.cwd(), "node_modules/electron/dist/electron.exe"),
  args: [...(process.argv[2] ? [] : ["."]), `--user-data-dir=${profile}`],
  cwd: process.cwd(),
  env,
});
const page = await application.firstWindow();

async function nativeIgnored() {
  return application.evaluate(async ({ app, BrowserWindow }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const koffi = createRequire(app.getAppPath() + "/package.json")("koffi");
    const user32 = koffi.load("user32.dll");
    const style = user32.func("__stdcall", "GetWindowLongPtrW", "intptr_t", [
      "uintptr_t",
      "int",
    ]);
    const handle = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
    return (Number(style(handle.readBigUInt64LE(), -20)) & 0x20) !== 0;
  });
}
async function expectIgnored(value) {
  for (let i = 0; i < 25; i++) {
    if ((await nativeIgnored()) === value) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  console.error(
    JSON.stringify({
      expectedIgnored: value,
      native: await application.evaluate(({ BrowserWindow, screen }) => ({
        bounds: BrowserWindow.getAllWindows()[0].getBounds(),
        cursor: screen.getCursorScreenPoint(),
      })),
      mascot: await page.locator(".mascot-button").boundingBox(),
      state: await page.evaluate(async () => {
        const s = await window.agenthud.snapshot();
        return {
          mode: s.mode,
          ghost: s.settings.clickThrough,
          available: s.ghostAvailable,
          error: s.ghostError,
        };
      }),
    }),
  );
  assert.equal(await nativeIgnored(), value);
}
async function pointAt(relative, expected) {
  for (let i = 0; i < 25; i++) {
    await application.evaluate(({ BrowserWindow, screen }, offset) => {
      const point = screen.getCursorScreenPoint();
      BrowserWindow.getAllWindows()[0].setPosition(
        Math.round(point.x - offset.x),
        Math.round(point.y - offset.y),
      );
    }, relative);
    await new Promise((resolve) => setTimeout(resolve, 40));
    if ((await nativeIgnored()) === expected) return;
  }
  await expectIgnored(expected);
}
try {
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  for (let i = 0; i < 40; i++) {
    if (
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
    "The native window must become visible before any UI input",
  );
  const snapshot = await page.evaluate(() => window.agenthud.snapshot());
  assert.equal(
    snapshot.ghostAvailable,
    true,
    "The Windows Alt reader must load in Electron",
  );
  assert.equal(
    snapshot.shortcutAvailable,
    true,
    "A recovery shortcut must be registered",
  );
  await page.evaluate(() => window.agenthud.window("panel"));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
    true,
    "Changing display mode must preserve the native pin",
  );
  await page.evaluate(() =>
    window.agenthud.setSettings({ clickThrough: true }),
  );
  await page.locator(".compact-bar.is-ghost").waitFor();
  await page.waitForFunction(() => innerHeight === 48);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
    true,
  );
  assert.equal(await page.evaluate(() => innerHeight), 48);
  await pointAt({ x: 150, y: 24 }, true);
  const box = await page.locator(".mascot-button").boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44);
  await pointAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, false);
  await page.screenshot({ path: ".cache/ghost-compact.png" });
  await pointAt({ x: 150, y: 24 }, true);
  await page
    .getByRole("button", { name: "Paneli genişlet", exact: true })
    .click();
  await expectIgnored(false);
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).settings
      .clickThrough,
    true,
  );
  await page.screenshot({ path: ".cache/ghost-panel.png" });
  await page.evaluate(() => window.agenthud.window("compact"));
  await pointAt({ x: 150, y: 24 }, true);
  await page.evaluate(() =>
    window.agenthud.setSettings({ clickThrough: false }),
  );
  await expectIgnored(false);
  await page.evaluate(() => window.agenthud.window("panel"));
  await page.evaluate(() =>
    window.agenthud.setSettings({ clickThrough: true }),
  );
  await page.evaluate(() => window.agenthud.window("dashboard"));
  await expectIgnored(false);
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).settings
      .clickThrough,
    false,
  );
  await writeFile(
    ".cache/ghost-result.json",
    JSON.stringify(
      {
        ok: true,
        version: await application.evaluate(({ app }) => app.getVersion()),
        recoveryShortcut: snapshot.recoveryShortcut,
        checked: [
          "native-windows-pass-through",
          "visible-before-first-input",
          "native-pin-after-mode-changes",
          "native-mascot-hit-region",
          "44px-mascot-target",
          "panel-interaction",
          "collapse-restores-pass-through",
          "disable-restores-input",
          "dashboard-restores-input",
          "native-alt-reader-loaded",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Windows ghost checks passed.");
} finally {
  await application.close();
}
