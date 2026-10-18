import test from "node:test";
import assert from "node:assert/strict";
import { parseNetstat, agentFor, flag } from "../electron/system.mjs";
import { projectDirectory, PortManager } from "../electron/ports.mjs";
import { codexState, readSessions } from "../electron/sessions.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("session discovery retains cwd when a large metadata header precedes events", async () => {
  const home = join(process.cwd(), ".cache", `test-sessions-${process.pid}`);
  const dir = join(
    home,
    "sessions",
    ...new Date().toISOString().slice(0, 10).split("-"),
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "fixture.jsonl"),
    JSON.stringify({
      type: "session_meta",
      payload: { cwd: "C:\\ex\\sample", base_instructions: "x".repeat(200000) },
    }) +
      "\n" +
      JSON.stringify({
        type: "event_msg",
        timestamp: new Date().toISOString(),
        payload: { type: "task_started" },
      }) +
      "\n",
  );
  const prior = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const sessions = await readSessions({ processes: [] });
    assert.equal(sessions[0]?.project, "sample");
    assert.equal(sessions[0]?.state, "working");
  } finally {
    if (prior === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prior;
  }
});
test("listener discovery deduplicates address families in the port manager", async () => {
  const listeners = parseNetstat(
    "  TCP    127.0.0.1:3000   0.0.0.0:0    LISTENING    42\n  TCP    [::]:3000   [::]:0    LISTENING    42\n  TCP    127.0.0.1:3000   127.0.0.1:90    ESTABLISHED    42",
  );
  assert.equal(listeners.length, 2);
  const manager = new PortManager();
  const entries = await manager.scan({
    listeners,
    processes: [
      {
        Name: "node.exe",
        ProcessId: 42,
        ParentProcessId: 1,
        CommandLine: "node server.js",
        CreationDate: "a",
      },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].port, 3000);
  assert.equal(entries[0].canRestart, false);
});
test("PID ancestor traversal finds an IDE and terminates on a cycle", () => {
  const parent = { Name: "Cursor.exe", ProcessId: 5, ParentProcessId: 9 };
  assert.equal(
    agentFor({ Name: "node.exe", ProcessId: 7, ParentProcessId: 5 }, [parent]),
    "cursor",
  );
  const p = { Name: "node.exe", ProcessId: 7, ParentProcessId: 7 };
  assert.equal(agentFor(p, [p]), null);
});
test("quoted Windows module paths resolve the actual project directory", () => {
  assert.equal(
    projectDirectory(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\ex\\My project\\node_modules\\vite\\bin\\vite.js"',
    ),
    "C:\\ex\\My project",
  );
  assert.equal(projectDirectory("node server.js"), null);
  assert.equal(
    flag(
      '--csrf_token "secret value" --extension_server_port=1234',
      "csrf_token",
    ),
    "secret value",
  );
  assert.equal(
    flag("--extension_server_port=1234", "extension_server_port"),
    "1234",
  );
});
test("a vanished server remains restartable only while its command is retained", async () => {
  const manager = new PortManager();
  await manager.scan({
    listeners: [{ port: 3000, pid: 42 }],
    processes: [
      {
        Name: "node.exe",
        ProcessId: 42,
        ParentProcessId: 1,
        CommandLine: "node server.js",
        CreationDate: "a",
      },
    ],
  });
  const entries = await manager.scan({ listeners: [], processes: [] });
  assert.equal(entries[0].status, "stopped");
  manager.entries.get("3000:42").stoppedAt = Date.now() - 600001;
  assert.deepEqual(await manager.scan({ listeners: [], processes: [] }), []);
  await assert.rejects(manager.stop("missing"), /artık açık değil/);
  assert.throws(() => manager.restart("missing"), /bilgisi bulunmuyor/);
});
test("Codex state follows authoritative task events and aborts", () => {
  const timestamp = new Date().toISOString();
  const start = {
    type: "event_msg",
    timestamp,
    payload: { type: "task_started" },
  };
  assert.equal(codexState([start]).state, "working");
  assert.equal(
    codexState([
      start,
      { type: "event_msg", timestamp, payload: { type: "task_complete" } },
    ]).state,
    "done",
  );
  assert.equal(
    codexState([
      start,
      { type: "event_msg", timestamp, payload: { type: "turn_aborted" } },
    ]).state,
    "idle",
  );
  assert.equal(
    codexState([
      {
        type: "event_msg",
        timestamp: "2020-01-01",
        payload: { type: "task_started" },
      },
    ]).state,
    "unknown",
  );
  assert.equal(
    codexState([{ type: "response_item", payload: { type: "tool_call" } }])
      .state,
    "unknown",
  );
});
