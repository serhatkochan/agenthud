import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateProcesses,
  chooseWindow,
  FocusService,
  sameProcessBirth,
} from "../electron/focus.mjs";

const session = {
  id: "cursor:session",
  provider: "cursor",
  project: "my-app",
  cwd: "C:\\ex\\my-app",
};
const window = (handle, title, extra = {}) => ({
  handle,
  pid: 20,
  creationId: "134370000000000009",
  title,
  app: "Cursor",
  ...extra,
});

test("one exact workspace caption wins over similar names and file names", () => {
  const windows = [
    window("1", "index.ts - my-app-next - Cursor"),
    window("2", "my-app - other-project - Cursor"),
    window("3", "index.ts - my-app - Cursor"),
  ];
  assert.deepEqual(chooseWindow(session, windows), {
    target: windows[2],
    scope: "project",
  });
});
test("duplicate project captions require a choice; a single generic agent window is explicitly application scope", () => {
  const a = window("1", "index.ts - my-app - Cursor"),
    b = window("2", "index.ts - my-app - Cursor");
  assert.deepEqual(chooseWindow(session, [a, b]), { choices: [a, b] });
  const generic = window("3", "Cursor Agents");
  assert.deepEqual(chooseWindow(session, [generic]), {
    target: generic,
    scope: "application",
  });
  assert.deepEqual(chooseWindow(session, []), { choices: [] });
});
test("unrecognized or misleading caption layouts do not invent project identity", () => {
  const a = window("1", "Discuss my-app roadmap"),
    b = window("2", "my-app-next - Cursor");
  assert.deepEqual(chooseWindow(session, [a, b]), { choices: [a, b] });
  const sameName = { ...session, cwd: "C:\\different\\my-app" };
  assert.equal(chooseWindow(sameName, [a, b]).target, undefined);
});
test("process candidates include only the provider and its eligible terminal or IDE ancestors", () => {
  const processes = [
    {
      ProcessId: 20,
      ParentProcessId: 10,
      Name: "codex.exe",
      CreationId: "134370000000000000",
    },
    { ProcessId: 10, ParentProcessId: 5, Name: "pwsh.exe" },
    { ProcessId: 5, ParentProcessId: 1, Name: "WindowsTerminal.exe" },
    { ProcessId: 1, ParentProcessId: 0, Name: "explorer.exe" },
    { ProcessId: 99, ParentProcessId: 1, Name: "chrome.exe" },
  ];
  const pids = candidateProcesses("codex", processes).map((p) => p.ProcessId);
  assert.deepEqual(pids, [20, 10, 5]);
  assert.deepEqual(candidateProcesses("unknown", processes), []);
  const cyclic = [{ ProcessId: 1, ParentProcessId: 1, Name: "Cursor.exe" }];
  assert.equal(candidateProcesses("cursor", cyclic).length, 1);
});
test("ambiguous choices use opaque session-bound IDs and expire without focusing anything", async () => {
  let now = 0;
  const calls = [];
  const candidates = [
    window("private-hwnd-1", "my-app - Cursor"),
    window("private-hwnd-2", "my-app - Cursor"),
  ];
  const service = new FocusService({
    list: async () => candidates,
    focus: async (target) => {
      calls.push(target);
      return "focused";
    },
    now: () => now,
  });
  const result = await service.request(session);
  assert.equal(result.choices.length, 2);
  assert.equal(JSON.stringify(result).includes("private-hwnd"), false);
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await service.request(
        { ...session, id: "other-session" },
        result.choices[0].id,
      )
    ).ok,
    false,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await service.request(
        { ...session, cwd: "C:\\other-project" },
        result.choices[0].id,
      )
    ).ok,
    false,
  );
  assert.equal(calls.length, 0);
  now = 60001;
  assert.equal(
    (await service.request(session, result.choices[0].id)).ok,
    false,
  );
  assert.equal(calls.length, 0);
});
test("process identity tolerates only CIM microsecond truncation and rejects recycled or missing identities", () => {
  assert.equal(
    sameProcessBirth("134370000000000000", "134370000000000009"),
    true,
  );
  assert.equal(
    sameProcessBirth("134370000000000010", "134370000000000009"),
    false,
  );
  assert.equal(sameProcessBirth(undefined, "134370000000000009"), false);
});
test("native failures are returned as recoverable results", async () => {
  const service = new FocusService({
    list: async () => [window("1", "my-app - Cursor")],
    focus: async () => {
      throw new Error("native unavailable");
    },
  });
  assert.equal((await service.request(session)).ok, false);
});
test("explicit choice revalidates window identity and failures never become success", async () => {
  let outcome = "stale";
  const selected = [];
  const candidates = [
    window("1", "my-app - Cursor"),
    window("2", "my-app - Cursor"),
  ];
  const service = new FocusService({
    list: async () => candidates,
    focus: async (target) => {
      selected.push(target.handle);
      return outcome;
    },
  });
  const result = await service.request(session);
  assert.equal(
    (await service.request(session, result.choices[1].id)).ok,
    false,
  );
  outcome = "focused";
  assert.equal((await service.request(session, result.choices[0].id)).ok, true);
  assert.deepEqual(selected, ["2", "1"]);
});
