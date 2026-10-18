import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { emitCursorFixture as emit } from "./fixtures/cursor.mjs";

await mkdir(".cache", { recursive: true });
const directory = await mkdtemp(join(process.cwd(), ".cache", "claude-ui-"));
const profile = join(directory, "hud-profile");
await mkdir(profile);
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    alwaysOnTop: true,
    notifications: false,
    refreshSeconds: 300,
  }),
);
const configPath = join(directory, "settings.json");
const original = {
  permissions: { deny: ["Bash(rm:*)"] },
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "existing-security-gate" }],
      },
    ],
  },
};
await writeFile(configPath, JSON.stringify(original));
const env = { ...process.env, AGENTHUD_CLAUDE_DIRECTORY: directory };
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
const connector = page.locator('[data-tracking-provider="claude"]');
try {
  await page
    .getByRole("heading", { name: "Kota radarı", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Ajanlar", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Claude Code durum takibini bağla",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Değişecek ayar dosyası", { exact: true }).click();
  assert.equal(await dialog.locator("code").textContent(), configPath);
  await page.screenshot({ path: ".cache/claude-tracking-connect.png" });
  await page.evaluate(() => window.agenthud.window("panel"));
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(380, 720),
  );
  await page.waitForFunction(() => innerWidth === 380);
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({ path: ".cache/claude-tracking-connect-380.png" });
  await dialog
    .getByRole("button", { name: "Takibi etkinleştir", exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.agenthud.snapshot()).claudeTracking.status === "waiting",
  );
  await connector.locator(".tracking-status.waiting").waitFor();
  await dialog.waitFor({ state: "hidden" });
  const installed = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(installed.permissions, original.permissions);
  assert.deepEqual(installed.hooks.PreToolUse, original.hooks.PreToolUse);
  const command = installed.hooks.UserPromptSubmit[0].hooks[0].command;
  const payload = {
    hook_event_name: "UserPromptSubmit",
    session_id: "ui-only-fixture",
    cwd: "C:\\ex\\Claude UI fixture",
    prompt: "PRIVATE FIXTURE CONTENT",
  };
  const row = page
    .locator('.session-row[data-provider="claude"]')
    .filter({ has: page.getByText("Claude UI fixture", { exact: true }) });
  for (const [event, extra, state, label] of [
    ["UserPromptSubmit", {}, "working", "İstek gönderildi"],
    [
      "Notification",
      { notification_type: "permission_prompt", message: "PRIVATE" },
      "blocked",
      "Onay bekliyor",
    ],
    ["PostToolUse", {}, "working", "Çalışıyor"],
    ["Stop", { last_assistant_message: "PRIVATE" }, "done", "Yanıt tamamlandı"],
  ]) {
    assert.deepEqual(
      await emit(command, { ...payload, ...extra, hook_event_name: event }),
      { code: 0, stdout: "{}", stderr: "" },
    );
    await page.waitForFunction(
      async (state) =>
        (await window.agenthud.snapshot()).sessions.some(
          (row) => row.id === "claude:ui-only-fixture" && row.state === state,
        ),
      state,
      { timeout: 16000 },
    );
    await row.locator(".agent-state").filter({ hasText: label }).waitFor();
    assert.equal(await row.locator(".agent-state").textContent(), label);
    if (state === "blocked") {
      await page.evaluate(() => window.agenthud.window("compact"));
      await page.locator(".mascot.blocked").waitFor();
      await page.screenshot({
        path: ".cache/claude-tracking-blocked-compact.png",
      });
      await page.evaluate(() => window.agenthud.window("panel"));
      await page.screenshot({ path: ".cache/claude-tracking-blocked.png" });
    }
  }
  assert.equal(
    await row.innerText().then((text) => text.includes("PRIVATE")),
    false,
  );
  await page
    .getByRole("button", {
      name: "Claude Code durum takibini kapat",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Takibi kapat", exact: true })
    .click();
  await page.waitForFunction(
    async () => !(await window.agenthud.snapshot()).claudeTracking.enabled,
  );
  await connector.locator(".tracking-status.off").waitFor();
  assert.equal(await connector.getAttribute("data-tracking-status"), "off");
  const final = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(final.permissions, original.permissions);
  assert.deepEqual(final.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.equal(
    (await page.evaluate(() => window.agenthud.snapshot())).sessions.some(
      (row) => row.id === "claude:ui-only-fixture",
    ),
    false,
  );
  await writeFile(configPath, "invalid fixture config");
  await page.waitForFunction(
    async () =>
      (await window.agenthud.snapshot()).claudeTracking.status === "error",
    null,
    { timeout: 16000 },
  );
  await page
    .getByRole("button", {
      name: "Claude Code durum takibini bağla",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Takibi etkinleştir", exact: true })
    .click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await readFile(configPath, "utf8"), "invalid fixture config");
  await page.screenshot({ path: ".cache/claude-tracking-error.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    ".cache/claude-ui-result.json",
    JSON.stringify(
      {
        ok: true,
        version: await application.evaluate(({ app }) => app.getVersion()),
        source:
          "official-shaped fixture events, actual Windows observer, isolated Claude settings; no account or live Claude session",
        checked: [
          "review-dialog",
          "380px-review-dialog",
          "preserve-settings-and-permissions",
          "enable",
          "working",
          "permission-wait",
          "blocked-mascot-compact",
          "resumed-tool",
          "response-done",
          "neutral-output",
          "disable-only-owned-observer",
          "invalid-config-preserved",
          "no-renderer-errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Claude Code tracking UI checks passed.");
} finally {
  await application.close();
}
