import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNetstat,
  agentFor,
  flag,
  attachWorkingDirectories,
} from "../electron/system.mjs";
import { projectHintDirectory, PortManager } from "../electron/ports.mjs";
import { codexState, readSessions } from "../electron/sessions.mjs";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

test("Go module names and compiled Go/Cargo children remain visible after the launcher exits", async () => {
  await mkdir(".cache", { recursive: true });
  const cwd = await mkdtemp(join(process.cwd(), ".cache", "go-project-"));
  await writeFile(
    join(cwd, "go.mod"),
    "module example.com/team/backend-api\n\ngo 1.24\n",
  );
  for (const launcher of ["go.exe", "cargo.exe"]) {
    const manager = new PortManager();
    const child = {
      Name: "backend.exe",
      ProcessId: 42,
      ParentProcessId: 41,
      CommandLine: '"C:\\build\\backend.exe"',
      ExecutablePath: "C:\\build\\backend.exe",
      WorkingDirectory: cwd,
      CreationDate: "identity-a",
    };
    const listeners = [{ pid: 42, port: 8080 }];
    const rows = await manager.scan({
      listeners,
      processes: [
        child,
        { Name: launcher, ProcessId: 41, ParentProcessId: 40 },
        { Name: "Cursor.exe", ProcessId: 40 },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project, "example.com/team/backend-api");
    assert.equal(rows[0].agent, "cursor");
    assert.equal(
      (await manager.scan({ listeners, processes: [child] }))[0]?.orphan,
      true,
    );
    assert.equal(
      (
        await manager.scan({
          listeners: [...listeners, { pid: 42, port: 8081 }],
          processes: [child],
        })
      ).filter((row) => row.status === "listening").length,
      2,
    );
    assert.equal(
      (
        await manager.scan({
          listeners,
          processes: [{ ...child, CreationDate: "identity-b" }],
        })
      )[0]?.status,
      "stopped",
    );
  }
});

test("a malformed package name cannot become a renderer object; unrelated executables stay out", async () => {
  await mkdir(".cache", { recursive: true });
  const cwd = await mkdtemp(join(process.cwd(), ".cache", "invalid-project-"));
  await writeFile(join(cwd, "package.json"), '{"name":{"unexpected":true}}');
  const child = {
    Name: "node.exe",
    ProcessId: 42,
    ParentProcessId: 42,
    WorkingDirectory: cwd,
  };
  const manager = new PortManager();
  const rows = await manager.scan({
    listeners: [{ pid: 42, port: 3000 }],
    processes: [child],
  });
  assert.equal(typeof rows[0].project, "string");
  const unknown = new PortManager();
  assert.equal(
    (
      await unknown.scan({
        listeners: [{ pid: 42, port: 8080 }],
        processes: [{ ...child, Name: "unrelated.exe" }],
      })
    ).length,
    0,
  );
});

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
  {
    const sessions = await readSessions(
      { processes: [], listeners: [] },
      { codexHome: home },
    );
    assert.equal(sessions[0]?.project, "sample");
    assert.equal(sessions[0]?.state, "working");
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
test("quoted Windows module paths provide only a project display hint", () => {
  assert.equal(
    projectHintDirectory(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\ex\\My project\\node_modules\\vite\\bin\\vite.js"',
    ),
    "C:\\ex\\My project",
  );
  assert.equal(projectHintDirectory("node server.js"), null);
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
test("script directory is only a display hint and cannot authorize restart", async () => {
  const manager = new PortManager();
  const entries = await manager.scan({
    listeners: [{ port: 3000, pid: 42 }],
    processes: [
      {
        Name: "node.exe",
        ProcessId: 42,
        ParentProcessId: 1,
        CommandLine: 'node "C:\\shared\\node_modules\\vite\\bin\\vite.js"',
        CreationDate: "a",
      },
    ],
  });
  assert.equal(entries[0].canRestart, false);
  assert.equal(manager.entries.get(entries[0].key).cwd, null);
});
test("native cwd is bound to PID and microsecond-precision CIM process creation time", () => {
  const processes = [
    { ProcessId: 42, CreationId: "134368017789901740" },
    { ProcessId: 43, CreationId: "134368017789901750" },
    { ProcessId: 44, CreationId: "134368017789901740" },
  ];
  const directories = [
    {
      ProcessId: 42,
      CreationId: "134368017789901749",
      WorkingDirectory: "C:\\actual",
    },
    {
      ProcessId: 43,
      CreationId: "134368017789901749",
      WorkingDirectory: "C:\\wrong-process",
    },
  ];
  assert.deepEqual(
    attachWorkingDirectories(processes, directories).map(
      (p) => p.WorkingDirectory,
    ),
    ["C:\\actual", null, null],
  );
});
test("authoritative working directory overrides a shared node_modules path", async () => {
  const manager = new PortManager();
  const entries = await manager.scan({
    listeners: [{ port: 3000, pid: 42 }],
    processes: [
      {
        Name: "node.exe",
        ProcessId: 42,
        ParentProcessId: 1,
        CommandLine: 'node "C:\\shared\\node_modules\\vite\\bin\\vite.js"',
        CreationDate: "a",
        WorkingDirectory: "C:\\apps\\actual",
      },
    ],
  });
  assert.equal(entries[0].canRestart, true);
  assert.equal(manager.entries.get(entries[0].key).cwd, "C:\\apps\\actual");
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
