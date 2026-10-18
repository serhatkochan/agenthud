import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

await mkdir(".cache", { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  args: process.argv[2] ? [] : ["."],
  cwd: process.cwd(),
  env,
  executablePath:
    process.argv[2] ||
    join(process.cwd(), "node_modules/electron/dist/electron.exe"),
  timeout: 30000,
});
const page = await application.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
try {
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  await page
    .locator(".connection-state.connected")
    .first()
    .waitFor({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Yenile", exact: true })
    .waitFor({ timeout: 45000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const snapshot = await page.evaluate(() => window.agenthud.snapshot());
  console.log(
    JSON.stringify({
      providers: snapshot.providers.map((p) => ({
        id: p.id,
        status: p.status,
        quotas: p.quotas,
      })),
      ports: snapshot.ports.length,
      sessions: snapshot.sessions.length,
    }),
  );
  await page.screenshot({ path: ".cache/dashboard.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator(".settings-nav").click();
  await page.getByRole("dialog").waitFor();
  const initial = snapshot.settings;
  await page
    .getByRole("switch", { name: "Her zaman üstte", exact: true })
    .click();
  const toggled = await page.evaluate(() => window.agenthud.snapshot());
  assert.equal(toggled.settings.alwaysOnTop, !initial.alwaysOnTop);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
    !initial.alwaysOnTop,
  );
  for (const label of ["Kota bildirimleri", "Kompakt başlat"])
    await page.getByRole("switch", { name: label, exact: true }).click();
  await page.getByLabel("Yenileme aralığı").selectOption("120");
  await page.screenshot({ path: ".cache/settings.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  for (const name of ["Cursor", "Antigravity", "Claude", "Codex"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("heading", { name: `${name} bağlantısı`, exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Pencereyi kapat", exact: true })
      .click();
  }
  await page.getByRole("button", { name: /^Ajanlar/ }).click();
  await page.getByRole("heading", { name: "Ajanların ne durumda?" }).waitFor();
  await page.screenshot({ path: ".cache/agents.png" });
  await page.getByRole("button", { name: /^Yerel portlar/ }).click();
  await page
    .getByRole("heading", { name: "Yerel portlar", exact: true })
    .waitFor();
  await page.screenshot({ path: ".cache/ports.png" });
  await page.getByRole("button", { name: /^Kota radarı/ }).click();
  await page
    .getByRole("button", { name: "Claude hesabını bağla", exact: true })
    .click();
  await page.getByRole("heading", { name: "Claude bağlantısı" }).waitFor();
  await page.screenshot({ path: ".cache/claude-connection.png" });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Kompakt görünüm", exact: true })
    .click();
  await page.getByRole("button", { name: "Paneli genişlet" }).waitFor();
  await page.screenshot({ path: ".cache/compact.png" });
  assert.equal(await page.evaluate(() => innerHeight), 48);
  await page.getByRole("button", { name: "Paneli genişlet" }).click();
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  await page.screenshot({ path: ".cache/panel.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Ayarları aç", exact: true }).click();
  await page
    .getByRole("button", { name: "Hayalet modunu aç", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).settings
      .clickThrough,
    true,
  );
  assert.equal(
    await application.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("CommandOrControl+Shift+H"),
    ),
    true,
  );
  await page.evaluate(() =>
    window.agenthud.setSettings({ clickThrough: false }),
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(380, 720),
  );
  assert.equal(
    await page
      .locator("main")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.getByRole("button", { name: "Ayarları aç", exact: true }).click();
  await page.screenshot({ path: ".cache/panel-settings-380.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  assert.notEqual(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle,
    ),
    "none",
  );
  await page
    .getByRole("button", { name: "Normal görünüm", exact: true })
    .click();
  await page.evaluate(
    (initial) => window.agenthud.setSettings(initial),
    initial,
  );
  await page
    .getByRole("button", { name: "Simge durumuna küçült", exact: true })
    .click();
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMinimized(),
    ),
    true,
  );
  await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.restore();
    w.focus();
  });
  await page
    .getByRole("button", { name: "Tepsiye gizle", exact: true })
    .click();
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await application.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
  });
  assert.deepEqual(errors, []);
  await writeFile(
    ".cache/ui-result.json",
    JSON.stringify(
      {
        ok: true,
        errors,
        providers: snapshot.providers.map((p) => ({
          id: p.id,
          status: p.status,
        })),
        checked: [
          "dashboard",
          "settings",
          "escape",
          "agents",
          "ports",
          "claude-dialog",
          "compact",
          "panel",
          "overflow",
          "native-always-on-top",
          "all-provider-dialogs",
          "notification-and-startup-settings",
          "ghost-mode-and-shortcut-registration",
          "380px-layout",
          "keyboard-focus",
          "native-minimize",
          "hide-to-tray",
        ],
      },
      null,
      2,
    ),
  );
  console.log("UI checks passed.");
} finally {
  await application.close();
}
