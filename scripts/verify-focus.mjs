import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { createReadStream, constants } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CursorTracker } from "../electron/cursor-tracking.mjs";
import { loadWindowApi } from "../electron/windows-focus.mjs";
import { emitCursorFixture } from "./fixtures/cursor.mjs";

const executable = join(
  process.cwd(),
  "node_modules/electron/dist/electron.exe",
);
const fixtureExe = join(dirname(executable), "Cursor.exe");
async function hash(path) {
  const value = createHash("sha256");
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest("hex");
}
try {
  await copyFile(executable, fixtureExe, constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  assert.equal(
    await hash(executable),
    await hash(fixtureExe),
    "Only the known test runtime can be reused",
  );
}
await mkdir(".cache", { recursive: true });
const root = await mkdtemp(join(process.cwd(), ".cache", "focus-ui-"));
const profile = join(root, "hud");
const fixtureProfile = join(root, "fixture");
await mkdir(profile, { recursive: true });
await mkdir(fixtureProfile, { recursive: true });
for (const folder of [profile, fixtureProfile])
  await writeFile(
    join(folder, "settings.json"),
    JSON.stringify({
      alwaysOnTop: folder === profile,
      notifications: false,
      refreshSeconds: 300,
    }),
  );
const tracker = new CursorTracker({ directory: join(root, "cursor") });
await tracker.setEnabled(true);
const config = JSON.parse(await readFile(tracker.configPath, "utf8"));
const project = `agenthud-focus-${randomUUID().slice(0, 8)}`;
const cwd = join(root, project);
await mkdir(cwd);
await emitCursorFixture(config.hooks.afterAgentThought[0].command, {
  hook_event_name: "afterAgentThought",
  conversation_id: "focus-ui-session",
  generation_id: "focus-ui-turn",
  workspace_roots: [cwd],
});
const baseEnv = { ...process.env };
delete baseEnv.ELECTRON_RUN_AS_NODE;
let fixture, application;
const native = loadWindowApi();
async function waitForeground(handle) {
  for (let i = 0; i < 40; i++) {
    if (native.foreground() === handle) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(native.foreground(), handle);
}
try {
  fixture = await electron.launch({
    executablePath: fixtureExe,
    args: [".", `--user-data-dir=${fixtureProfile}`],
    cwd: process.cwd(),
    env: { ...baseEnv, AGENTHUD_CURSOR_DIRECTORY: join(root, "unused-cursor") },
  });
  const fixturePage = await fixture.firstWindow();
  await fixturePage
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  const titleA = `a.ts - ${project} - Cursor`;
  const titleB = `b.ts - ${project} - Cursor`;
  const first = await fixture.evaluate(({ BrowserWindow }, title) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setTitle(title);
    win.show();
    return {
      id: win.id,
      handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
    };
  }, titleA);
  application = await electron.launch({
    executablePath: process.argv[2] || executable,
    args: [...(process.argv[2] ? [] : ["."]), `--user-data-dir=${profile}`],
    cwd: process.cwd(),
    env: { ...baseEnv, AGENTHUD_CURSOR_DIRECTORY: tracker.directory },
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Ajanlar", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await window.agenthud.snapshot()).sessions.some(
        (row) => row.id === "cursor:focus-ui-session",
      ),
    null,
    { timeout: 16000 },
  );
  const row = page
    .locator('.session-row[data-provider="cursor"]')
    .filter({ has: page.getByText(project, { exact: true }) });
  await fixture.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).minimize(),
    first.id,
  );
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await row
    .getByRole("button", {
      name: `${project} penceresine odaklan`,
      exact: true,
    })
    .click();
  await waitForeground(first.handle);
  assert.equal(
    await fixture.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).isMinimized(),
      first.id,
    ),
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).mode,
    "compact",
  );
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    ),
    true,
  );
  const second = await fixture.evaluate(async ({ BrowserWindow }, title) => {
    const win = new BrowserWindow({
      width: 640,
      height: 400,
      title,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadURL(
      "data:text/html,<title>" +
        encodeURIComponent(title) +
        "</title><p>AgentHUD focus fixture</p>",
    );
    win.setTitle(title);
    return {
      id: win.id,
      handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
    };
  }, titleB);
  await page.evaluate(() => window.agenthud.window("dashboard"));
  const bounds = await application.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      window: win.getBounds(),
      work: screen.getDisplayMatching(win.getBounds()).workArea,
    };
  });
  assert.ok(
    bounds.window.x >= bounds.work.x &&
      bounds.window.y >= bounds.work.y &&
      bounds.window.x + bounds.window.width <=
        bounds.work.x + bounds.work.width &&
      bounds.window.y + bounds.window.height <=
        bounds.work.y + bounds.work.height,
    "Expanded HUD must fit in the display work area",
  );
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await row
    .getByRole("button", {
      name: `${project} penceresine odaklan`,
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Hangi pencereyi açalım?", exact: true })
    .waitFor();
  assert.equal(await page.locator(".focus-choice").count(), 2);
  await page.screenshot({ path: ".cache/focus-choices.png" });
  await page
    .getByRole("button", { name: `${titleB} penceresini aç`, exact: true })
    .click();
  await waitForeground(second.handle);
  await page.evaluate(() => window.agenthud.window("dashboard"));
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.focus();
  });
  await row
    .getByRole("button", {
      name: `${project} penceresine odaklan`,
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Hangi pencereyi açalım?", exact: true })
    .waitFor();
  await page.evaluate(() => window.agenthud.window("panel"));
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(380, 720),
  );
  await page.waitForFunction(() => innerWidth === 380);
  assert.equal(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
  await page.screenshot({ path: ".cache/focus-choices-380.png" });
  await fixture.evaluate(
    ({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(),
    second.id,
  );
  await page
    .getByRole("button", { name: `${titleB} penceresini aç`, exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.match(
    await page.getByRole("alert").textContent(),
    /değişmiş veya kapanmış/,
  );
  await page
    .getByRole("button", { name: "Listeyi yenile", exact: true })
    .click();
  await waitForeground(first.handle);
  assert.equal(
    (await page.evaluate(() => window.agenthud.focus("missing-session"))).ok,
    false,
  );
  assert.equal(
    (
      await page.evaluate(() =>
        window.agenthud.focus("cursor:focus-ui-session", "forged-choice"),
      )
    ).ok,
    false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".cache/focus-result.json",
    JSON.stringify(
      {
        ok: true,
        version: await application.evaluate(({ app }) => app.getVersion()),
        scope:
          "two owned fixture windows in a separate process; real Win32 foreground readback",
        checked: [
          "process-identity",
          "unique-project-caption",
          "restore-minimized",
          "real-foreground",
          "pinned-hud-preserves-target-focus",
          "compact-after-focus",
          "expanded-hud-within-work-area",
          "multiple-window-picker",
          "explicit-choice",
          "closed-window-rejected",
          "refresh-choice-list",
          "380px-picker",
          "unknown-session-rejected",
          "forged-choice-rejected",
          "no-renderer-errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Windows project focus checks passed.");
} finally {
  await application?.close();
  await fixture?.close();
}
