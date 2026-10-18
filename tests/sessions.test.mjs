import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { readSessions } from "../electron/sessions.mjs";

async function fixture(t, payload, status = 200) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  return {
    processes: [
      { Name: "Antigravity.exe", ProcessId: 2 },
      {
        Name: "language_server.exe",
        ProcessId: 1,
        ExecutablePath: "C:\\Antigravity\\language_server.exe",
        CommandLine: `server --csrf_token fixture --extension_server_port ${port}`,
      },
    ],
    listeners: [{ pid: 1, port }],
  };
}
const options = {
  codexHome: join(process.cwd(), ".cache", "empty-codex-sessions"),
};
test("the session monitor shows measured Antigravity projects once instead of a generic process row", async (t) => {
  const system = await fixture(t, {
    trajectorySummaries: {
      abc: {
        status: "CASCADE_RUN_STATUS_RUNNING",
        lastModifiedTime: "2026-10-18T10:00:00Z",
        workspaces: [
          { workspaceFolderAbsoluteUri: "file:///c:/ex/live-project" },
        ],
      },
    },
  });
  const rows = (await readSessions(system, options)).filter(
    (s) => s.provider === "antigravity",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project, "live-project");
  assert.equal(rows[0].state, "working");
  assert.equal(rows[0].source, "Antigravity · yerel servis");
});
test("an unreachable agent service remains unknown rather than looking idle or working", async (t) => {
  const system = await fixture(t, { error: "not ready" }, 503);
  const rows = await readSessions(system, options);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "unknown");
  assert.equal(rows[0].project, "Uygulama açık");
  assert.equal(rows[0].source, "Yalnızca uygulama süreci");
});
