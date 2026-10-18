import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { emitCursorFixture } from "./fixtures/cursor.mjs";

const profile = join(process.cwd(), ".cache", "cursor-ui-profile");
await mkdir(profile, { recursive: true });
const directory = await mkdtemp(
  join(process.cwd(), ".cache", "cursor-ui-home-"),
);
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    alwaysOnTop: true,
    notifications: false,
    refreshSeconds: 300,
  }),
);
const original = {
  version: 1,
  hooks: {
    preToolUse: [{ command: "existing-security-gate" }],
    stop: [{ command: "existing-stop-hook" }],
  },
};
const configPath = join(directory, "hooks.json");
await writeFile(configPath, JSON.stringify(original));
const env = { ...process.env, AGENTHUD_CURSOR_DIRECTORY: directory };
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
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Ajanlar", exact: true }).click();
  await page
    .getByRole("button", { name: "Cursor durum takibini bağla", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cursor durum takibi", exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByText("Değişecek ayar dosyası", { exact: true })
    .click();
  assert.equal(
    await page.getByRole("dialog").locator(".tracking-file code").textContent(),
    configPath,
  );
  await page.screenshot({ path: ".cache/cursor-tracking-connect.png" });
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
  await page.screenshot({ path: ".cache/cursor-tracking-connect-380.png" });
  await page
    .getByRole("button", { name: "Takibi etkinleştir", exact: true })
    .click();
  await page
    .locator(
      '[data-tracking-provider="cursor"][data-tracking-status="waiting"]',
    )
    .waitFor({ timeout: 16000 });
  await page.evaluate(() => window.agenthud.window("dashboard"));
  const installed = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(installed.hooks.preToolUse, original.hooks.preToolUse);
  const command = installed.hooks.afterAgentThought[0].command;
  const payload = {
    hook_event_name: "afterAgentThought",
    conversation_id: "ui-only-fixture",
    generation_id: "ui-fixture-turn",
    workspace_roots: ["C:\\ex\\AgentHUD UI fixture"],
    text: "PRIVATE FIXTURE CONTENT",
  };
  const result = await emitCursorFixture(command, payload);
  assert.equal(result.stdout, "{}");
  assert.equal(result.code, 0);
  await page.waitForFunction(
    async () =>
      (await window.agenthud.snapshot()).sessions.some(
        (row) => row.id === "cursor:ui-only-fixture" && row.state === "working",
      ),
    null,
    { timeout: 16000 },
  );
  const row = page
    .locator('.session-row[data-provider="cursor"]')
    .filter({ has: page.getByText("AgentHUD UI fixture", { exact: true }) });
  await row.locator(".agent-state").filter({ hasText: "Çalışıyor" }).waitFor();
  assert.equal(await row.locator(".agent-state").textContent(), "Çalışıyor");
  await page.screenshot({ path: ".cache/cursor-tracking-active.png" });
  await emitCursorFixture(command, {
    ...payload,
    hook_event_name: "stop",
    status: "completed",
  });
  await page.waitForFunction(
    async () =>
      (await window.agenthud.snapshot()).sessions.some(
        (row) => row.id === "cursor:ui-only-fixture" && row.state === "done",
      ),
    null,
    { timeout: 16000 },
  );
  await row.locator(".agent-state").filter({ hasText: "Tamamlandı" }).waitFor();
  assert.equal(await row.locator(".agent-state").textContent(), "Tamamlandı");
  await page
    .getByRole("button", { name: "Cursor durum takibini kapat", exact: true })
    .click();
  await page.getByRole("button", { name: "Takibi kapat", exact: true }).click();
  await page
    .locator('[data-tracking-provider="cursor"][data-tracking-status="off"]')
    .waitFor({ timeout: 16000 });
  const final = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(final.hooks.preToolUse, original.hooks.preToolUse);
  assert.deepEqual(final.hooks.stop, original.hooks.stop);
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).sessions.some(
      (row) => row.id === "cursor:ui-only-fixture",
    ),
    false,
  );
  await writeFile(configPath, "invalid fixture config");
  await page
    .locator('[data-tracking-provider="cursor"][data-tracking-status="error"]')
    .waitFor({ timeout: 16000 });
  await page
    .getByRole("button", { name: "Cursor durum takibini bağla", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Takibi etkinleştir", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(await readFile(configPath, "utf8"), "invalid fixture config");
  await page.screenshot({ path: ".cache/cursor-tracking-error.png" });
  await page
    .getByRole("button", { name: "Takip penceresini kapat", exact: true })
    .click();
  await writeFile(configPath, JSON.stringify(original));
  assert.deepEqual(errors, []);
  await writeFile(
    ".cache/cursor-ui-result.json",
    JSON.stringify(
      {
        ok: true,
        version: await application.evaluate(({ app }) => app.getVersion()),
        source:
          "official-shaped fixture events, actual Windows observer, isolated Cursor directory",
        checked: [
          "review-dialog",
          "380px-review-dialog",
          "preserve-existing-hooks",
          "enable",
          "neutral-observer-output",
          "working-event-through-live-poll",
          "done-event-through-live-poll",
          "disable-only-owned-observer",
          "invalid-config-never-overwritten",
          "inline-failure",
          "no-renderer-errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Cursor tracking UI checks passed.");
} finally {
  await application.close();
}
