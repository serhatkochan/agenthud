import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CursorTracker,
  reduceCursorEvents,
} from "../electron/cursor-tracking.mjs";

async function fixture() {
  await mkdir(".cache", { recursive: true });
  const directory = await mkdtemp(
    join(process.cwd(), ".cache", "cursor-track-"),
  );
  return {
    directory,
    tracker: new CursorTracker({ directory }),
    configPath: join(directory, "hooks.json"),
  };
}
const now = Date.now();
const event = (type, extra = {}) => ({
  version: 1,
  event: type,
  conversationId: "conversation-1",
  generationId: "turn-1",
  roots: ["C:\\ex\\sample"],
  at: new Date(now).toISOString(),
  ...extra,
});

test("tracking installation preserves other hooks, is idempotent and backs up exact original bytes", async () => {
  const { directory, tracker, configPath } = await fixture();
  const original =
    '{"version":1,"other":{"keep":true},"hooks":{"stop":[{"command":"other-observer"}],"preToolUse":[{"command":"security-gate"}]}}\n';
  await writeFile(configPath, original);
  assert.equal((await tracker.status()).enabled, false);
  await tracker.setEnabled(true);
  const installed = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(installed.hooks.preToolUse, [{ command: "security-gate" }]);
  assert.equal(installed.hooks.stop[0].command, "other-observer");
  assert.deepEqual(installed.other, { keep: true });
  assert.equal(installed.hooks.stop.length, 2);
  assert.equal(installed.hooks.beforeSubmitPrompt, undefined);
  assert.equal((await tracker.status()).enabled, true);
  const bytes = await readFile(configPath, "utf8");
  await tracker.setEnabled(true);
  assert.equal(await readFile(configPath, "utf8"), bytes);
  const backup = (await readdir(directory)).find((name) =>
    name.endsWith(".bak"),
  );
  assert.ok(backup);
  assert.equal(await readFile(join(directory, backup), "utf8"), original);
});
test("disabling removes only the owned observer, retaining hooks added after installation", async () => {
  const { tracker, configPath } = await fixture();
  await tracker.setEnabled(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.hooks.stop.push({ command: "new-user-hook" });
  await writeFile(configPath, JSON.stringify(config));
  await tracker.setEnabled(false);
  const final = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(final.hooks.stop, [{ command: "new-user-hook" }]);
  assert.equal((await tracker.status()).enabled, false);
});
test("the owned observer remains removable after its implementation revision changes", async () => {
  const { tracker, configPath } = await fixture();
  await tracker.setEnabled(true);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const command = config.hooks.stop[0].command;
  const prefix =
    "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ";
  const previous =
    prefix +
    Buffer.from(
      Buffer.from(command.slice(prefix.length), "base64").toString("utf16le") +
        "\n# previous implementation",
      "utf16le",
    ).toString("base64");
  for (const entries of Object.values(config.hooks))
    for (const entry of entries)
      if (entry.command === command) entry.command = previous;
  config.hooks.stop.push({
    command:
      prefix + Buffer.from("# Another observer", "utf16le").toString("base64"),
  });
  await writeFile(configPath, JSON.stringify(config));
  assert.equal((await tracker.status()).enabled, true);
  await tracker.setEnabled(false);
  assert.equal(
    JSON.parse(await readFile(configPath, "utf8")).hooks.stop.length,
    1,
  );
});
test("invalid or future configs are never overwritten", async () => {
  for (const content of [
    "not json",
    "[]",
    '{"version":2,"hooks":{}}',
    '{"version":1,"hooks":{"stop":42}}',
  ]) {
    const { tracker, configPath } = await fixture();
    await writeFile(configPath, content);
    await assert.rejects(tracker.setEnabled(true));
    assert.equal(await readFile(configPath, "utf8"), content);
    assert.equal((await tracker.status()).status, "error");
  }
});
test("non-UTF8 config bytes are rejected without changing the original file", async () => {
  const { tracker, configPath } = await fixture();
  const bytes = Buffer.concat([
    Buffer.from('{"version":1,"hooks":{},"note":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  await writeFile(configPath, bytes);
  await assert.rejects(tracker.setEnabled(true));
  assert.deepEqual(await readFile(configPath), bytes);
});
test("opposite simultaneous requests are applied in order instead of silently losing the last request", async () => {
  const { tracker } = await fixture();
  await Promise.all([tracker.setEnabled(true), tracker.setEnabled(false)]);
  assert.equal((await tracker.status()).enabled, false);
});
test("lifecycle records map only known states and never leak extra payload fields", () => {
  const rows = reduceCursorEvents(
    [
      event("afterAgentThought", {
        text: "PRIVATE",
        user_email: "PRIVATE",
        tool_input: { command: "PRIVATE" },
      }),
    ],
    { now },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "working");
  assert.equal(rows[0].project, "sample");
  assert.equal(rows[0].source, "Cursor · oturum olayları");
  assert.equal(JSON.stringify(rows).includes("PRIVATE"), false);
  assert.equal(
    reduceCursorEvents([event("sessionStart")], { now })[0].state,
    "idle",
  );
  assert.equal(
    reduceCursorEvents([event("stop", { status: "completed" })], { now })[0]
      .state,
    "done",
  );
  assert.equal(
    reduceCursorEvents([event("stop", { status: "aborted" })], { now })[0]
      .state,
    "idle",
  );
  assert.equal(
    reduceCursorEvents([event("stop", { status: "error" })], { now })[0].state,
    "unknown",
  );
});
test("a completed generation wins over late working records, and an old stop cannot close a newer generation", () => {
  const at = (ms) => new Date(now + ms).toISOString();
  const old = event("stop", { status: "completed", at: at(1000) });
  assert.equal(
    reduceCursorEvents([old, event("afterAgentThought", { at: at(500) })], {
      now: now + 2000,
    })[0].state,
    "done",
  );
  assert.equal(
    reduceCursorEvents(
      [
        old,
        event("afterAgentThought", { generationId: "turn-2", at: at(1500) }),
      ],
      { now: now + 2000 },
    )[0].state,
    "working",
  );
  assert.equal(
    reduceCursorEvents(
      [
        event("afterAgentThought", { at: at(0) }),
        event("stop", { status: "completed", at: at(2500) }),
        event("afterAgentThought", { generationId: "turn-2", at: at(1500) }),
      ],
      { now: now + 3000 },
    )[0].state,
    "working",
  );
});
test("malformed, unknown, future and old records never fabricate activity; old working leases become unknown", () => {
  for (const value of [
    null,
    {},
    event("beforeShellExecution"),
    event("new-event"),
    event("afterAgentThought", { at: "bad" }),
    event("afterAgentThought", { conversationId: "../../escape" }),
    event("afterAgentThought", { at: new Date(now + 86400000).toISOString() }),
    event("stop", { at: new Date(now - 86400001).toISOString() }),
  ])
    assert.deepEqual(reduceCursorEvents([value], { now }), []);
  assert.equal(
    reduceCursorEvents(
      [
        event("afterAgentThought", {
          at: new Date(now - 16 * 60000).toISOString(),
        }),
      ],
      { now },
    )[0].state,
    "unknown",
  );
});
