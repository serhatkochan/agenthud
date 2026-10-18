import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inventory } from "../electron/system.mjs";
import { PortManager } from "../electron/ports.mjs";

const root = join(process.cwd(), ".cache", "port-fixture");
const directory = join(root, "node_modules", "agenthud-fixture");
const actualCwd = join(root, "apps", "Gerçek çalışma alanı");
await mkdir(directory, { recursive: true });
await mkdir(actualCwd, { recursive: true });
const script = join(directory, "server.mjs");
await writeFile(
  join(actualCwd, "package.json"),
  JSON.stringify({ name: "agenthud-port-test" }),
);
await writeFile(
  script,
  "import http from 'node:http';http.createServer((_,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({marker:'agenthud-port-test',cwd:process.cwd()}));}).listen(Number(process.argv[2]),'127.0.0.1',()=>console.log('ready')); ",
);
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(process.execPath, [script, String(port)], {
  cwd: actualCwd,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  child.stdout.once("data", resolve);
  child.once("error", reject);
  setTimeout(
    () => reject(new Error("Fixture startup timed out")),
    10000,
  ).unref();
});
const manager = new PortManager();
try {
  const entries = await manager.scan(await inventory());
  const entry = entries.find((e) => e.port === port && e.pid === child.pid);
  assert.ok(entry);
  assert.equal(entry.project, "agenthud-port-test");
  assert.equal(entry.canRestart, true);
  assert.equal(manager.entries.get(entry.key).cwd, actualCwd);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}`)).json(), {
    marker: "agenthud-port-test",
    cwd: actualCwd,
  });
  await manager.stop(entry.key);
  assert.equal(
    manager.publicEntries().find((e) => e.key === entry.key).status,
    "stopped",
  );
  await manager.restart(entry.key);
  let response;
  for (let i = 0; i < 30; i++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(response);
  assert.deepEqual(await response.json(), {
    marker: "agenthud-port-test",
    cwd: actualCwd,
  });
  console.log(
    JSON.stringify({
      ok: true,
      port,
      checks: [
        "real-listener",
        "project",
        "stop",
        "stopped-memory",
        "restart-same-command",
      ],
    }),
  );
} finally {
  try {
    child.kill();
  } catch {}
  const s = await inventory();
  for (const p of s.processes.filter((p) => p.CommandLine?.includes(script))) {
    try {
      process.kill(p.ProcessId);
    } catch {}
  }
}
