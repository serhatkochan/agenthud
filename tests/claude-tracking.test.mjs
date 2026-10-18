import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ClaudeTracker,
  reduceClaudeEvents,
} from "../electron/claude-tracking.mjs";
import { emitCursorFixture as invoke } from "../scripts/fixtures/cursor.mjs";

async function fixture() {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(
    join(process.cwd(), ".cache", "claude-Türkçe-'"),
  );
  return new ClaudeTracker({ directory });
}
const now = Date.now();
const event = (type, extra = {}) => ({
  version: 1,
  event: type,
  sessionId: "session-1",
  cwd: "C:\\ex\\sample",
  at: new Date(now).toISOString(),
  ...extra,
});

test("Claude settings retain permissions and nested user hooks across installation, revision and removal", async () => {
  const tracker = await fixture();
  const original = {
    permissions: { deny: ["Bash(rm:*)"] },
    env: { KEEP: "yes" },
    hooks: {
      Notification: [
        {
          matcher: "permission_prompt",
          hooks: [{ type: "command", command: "user-observer" }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "security-gate" }],
        },
      ],
    },
  };
  const bytes = "\uFEFF" + JSON.stringify(original);
  await writeFile(tracker.configPath, bytes);
  await tracker.setEnabled(true);
  let installed = JSON.parse(await readFile(tracker.configPath, "utf8"));
  assert.deepEqual(installed.permissions, original.permissions);
  assert.deepEqual(installed.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.deepEqual(
    installed.hooks.Notification[0],
    original.hooks.Notification[0],
  );
  assert.equal(installed.hooks.PermissionRequest, undefined);
  const managed = installed.hooks.Notification.at(-1);
  assert.equal(managed.matcher, "permission_prompt|idle_prompt");
  assert.equal(managed.hooks[0].type, "command");
  assert.equal(managed.hooks[0].async, undefined);
  const before = await readFile(tracker.configPath, "utf8");
  await tracker.setEnabled(true);
  assert.equal(await readFile(tracker.configPath, "utf8"), before);
  const backups = (await readdir(tracker.directory)).filter((name) =>
    name.endsWith(".bak"),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    await readFile(join(tracker.directory, backups[0]), "utf8"),
    bytes,
  );
  managed.hooks.push({ type: "command", command: "later-user-observer" });
  await writeFile(tracker.configPath, JSON.stringify(installed));
  await tracker.setEnabled(false);
  installed = JSON.parse(await readFile(tracker.configPath, "utf8"));
  assert.deepEqual(installed.hooks.Notification.at(-1).hooks, [
    { type: "command", command: "later-user-observer" },
  ]);
  assert.deepEqual(installed.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.equal((await tracker.status()).enabled, false);
});

test("Claude malformed config is preserved and globally disabled hooks are not silently enabled", async () => {
  for (const content of [
    "broken",
    "[]",
    '{"hooks":42}',
    '{"hooks":{"Stop":[{"hooks":42}]}}',
  ]) {
    const tracker = await fixture();
    await writeFile(tracker.configPath, content);
    await assert.rejects(tracker.setEnabled(true));
    assert.equal(await readFile(tracker.configPath, "utf8"), content);
  }
  const tracker = await fixture();
  await tracker.setEnabled(true);
  const config = JSON.parse(await readFile(tracker.configPath, "utf8"));
  config.disableAllHooks = true;
  await writeFile(tracker.configPath, JSON.stringify(config));
  const connection = await tracker.status();
  assert.equal(connection.status, "error");
  assert.equal(connection.enabled, true);
  assert.deepEqual((await tracker.readSessions()).sessions, []);
  await tracker.setEnabled(false);
  assert.equal(
    JSON.parse(await readFile(tracker.configPath, "utf8")).disableAllHooks,
    true,
  );
});

test("Claude lifecycle distinguishes request, permission wait, resumed tools, response end and session close", () => {
  const records = [];
  const emit = (type, extra = {}) => {
    records.push(
      event(type, {
        ...extra,
        at: new Date(now + records.length * 100).toISOString(),
      }),
    );
    return reduceClaudeEvents(records, { now: now + 1000 })[0];
  };
  assert.equal(emit("SessionStart").state, "idle");
  assert.equal(emit("UserPromptSubmit").statusLabel, "İstek gönderildi");
  assert.equal(
    emit("Notification", { notificationType: "permission_prompt" }).state,
    "blocked",
  );
  assert.equal(emit("PostToolUse").state, "working");
  assert.equal(emit("Stop").statusLabel, "Yanıt tamamlandı");
  assert.equal(emit("UserPromptSubmit").state, "working");
  assert.equal(emit("StopFailure").state, "unknown");
  assert.equal(emit("SessionEnd").state, "idle");
});

test("Claude background work, stale events and unrecognized notifications cannot appear as completion or approval", () => {
  assert.equal(
    reduceClaudeEvents([event("Stop", { background: true })], { now })[0].state,
    "working",
  );
  assert.equal(
    reduceClaudeEvents([event("PostToolUse")], { now: now + 16 * 60000 })[0]
      .state,
    "unknown",
  );
  assert.equal(
    reduceClaudeEvents(
      [
        event("Notification", {
          notificationType: "custom",
          message: "permission",
        }),
      ],
      { now },
    ).length,
    0,
  );
  assert.equal(
    reduceClaudeEvents([event("UserPromptSubmit", { at: "bad" })], { now })
      .length,
    0,
  );
  assert.equal(
    reduceClaudeEvents([event("Stop", { agentId: "child" })], { now }).length,
    0,
  );
});

test(
  "actual Claude Windows observer emits neutral JSON and records only lifecycle metadata",
  { skip: process.platform !== "win32" },
  async () => {
    const tracker = await fixture();
    await tracker.setEnabled(true);
    const command = await tracker.command();
    const payload = {
      session_id: "fixture-session",
      cwd: "C:\\ex\\Türkçe proje",
      hook_event_name: "UserPromptSubmit",
      prompt: "PRIVATE",
      transcript_path: "PRIVATE",
      tool_input: { command: "PRIVATE" },
    };
    for (const [type, extra, expected] of [
      ["UserPromptSubmit", {}, "working"],
      [
        "Notification",
        { notification_type: "permission_prompt", message: "PRIVATE" },
        "blocked",
      ],
      ["PostToolUse", { tool_response: "PRIVATE" }, "working"],
      ["Stop", { last_assistant_message: "PRIVATE" }, "done"],
      ["Stop", { background_tasks: [{ command: "PRIVATE" }] }, "working"],
      ["StopFailure", { error_details: "PRIVATE" }, "unknown"],
      ["SessionEnd", {}, "idle"],
    ]) {
      const result = await invoke(command, {
        ...payload,
        ...extra,
        hook_event_name: type,
      });
      assert.deepEqual(result, { code: 0, stdout: "{}", stderr: "" });
      const rows = (await tracker.readSessions()).sessions;
      assert.equal(rows[0]?.state, expected);
      assert.equal(rows[0]?.project, "Türkçe proje");
    }
    for (const name of await readdir(tracker.eventsDirectory))
      assert.equal(
        (await readFile(join(tracker.eventsDirectory, name), "utf8")).includes(
          "PRIVATE",
        ),
        false,
      );
    const count = (await readdir(tracker.eventsDirectory)).length;
    await invoke(command, { ...payload, hook_event_name: "PermissionRequest" });
    await invoke(command, "invalid");
    assert.equal((await readdir(tracker.eventsDirectory)).length, count);
  },
);
