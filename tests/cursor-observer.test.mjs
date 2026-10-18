import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CursorTracker } from "../electron/cursor-tracking.mjs";
import { emitCursorFixture as invoke } from "../scripts/fixtures/cursor.mjs";
test(
  "the actual Windows observer outputs neutral JSON, stores only metadata, and drives the session monitor",
  { skip: process.platform !== "win32" },
  async () => {
    await mkdir(".cache", { recursive: true });
    const directory = await mkdtemp(
      join(process.cwd(), ".cache", "cursor-Türkçe-'"),
    );
    const tracker = new CursorTracker({ directory });
    await tracker.setEnabled(true);
    const config = JSON.parse(await readFile(tracker.configPath, "utf8"));
    const command = config.hooks.afterAgentThought[0].command;
    const payload = {
      hook_event_name: "afterAgentThought",
      conversation_id: "fixture-session",
      generation_id: "fixture-turn",
      workspace_roots: ["C:\\ex\\Türkçe proje"],
      text: "PRIVATE THOUGHT",
      user_email: "PRIVATE EMAIL",
      tool_input: { command: "PRIVATE COMMAND" },
    };
    const first = await invoke(command, JSON.stringify(payload));
    assert.equal(first.code, 0);
    assert.equal(first.stdout, "{}");
    assert.equal(first.stderr, "");
    const files = await readdir(tracker.eventsDirectory);
    assert.equal(files.length, 1);
    const raw = await readFile(join(tracker.eventsDirectory, files[0]), "utf8");
    assert.equal(raw.includes("PRIVATE"), false);
    const working = await tracker.readSessions();
    assert.equal(working.connection.status, "active");
    assert.equal(working.sessions[0]?.state, "working");
    assert.equal(working.sessions[0]?.project, "Türkçe proje");
    assert.equal(
      (
        await invoke(
          command,
          JSON.stringify({
            ...payload,
            hook_event_name: "stop",
            status: "completed",
          }),
        )
      ).stdout,
      "{}",
    );
    assert.equal((await tracker.readSessions()).sessions[0]?.state, "done");
    const before = (await readdir(tracker.eventsDirectory)).length;
    assert.equal(
      (
        await invoke(
          command,
          JSON.stringify({
            ...payload,
            hook_event_name: "beforeShellExecution",
          }),
        )
      ).stdout,
      "{}",
    );
    assert.equal((await invoke(command, "not json")).stdout, "{}");
    assert.equal((await readdir(tracker.eventsDirectory)).length, before);
    await tracker.setEnabled(false);
    assert.deepEqual((await tracker.readSessions()).sessions, []);
  },
);
