import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  languageServers,
  postLanguageServer,
} from "../electron/antigravity-client.mjs";

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}
test("language server discovery uses process-owned listeners and its explicit fallback", () => {
  const servers = languageServers({
    processes: [
      {
        Name: "language_server.exe",
        ProcessId: 10,
        ExecutablePath: "C:\\Antigravity\\language_server.exe",
        CommandLine:
          "server --csrf_token fixture --extension_server_port 1235 --extension_server_csrf_token fallback",
      },
    ],
    listeners: [
      { pid: 10, port: 1234 },
      { pid: 99, port: 9999 },
      { pid: 10, port: 1234 },
    ],
  });
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].targets, [
    { port: 1234, token: "fixture", secure: true },
    { port: 1235, token: "fallback", secure: false },
  ]);
});
test("local RPC sends the real metadata contract and parses a successful response", async (t) => {
  const port = await localServer(t, (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const valid =
        req.url ===
          "/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories" &&
        req.headers["x-codeium-csrf-token"] === "fixture" &&
        JSON.parse(body).metadata.ideName === "antigravity";
      res.writeHead(valid ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ trajectorySummaries: {} }));
    });
  });
  assert.deepEqual(
    await postLanguageServer(
      { port, token: "fixture", secure: false },
      "GetAllCascadeTrajectories",
    ),
    { trajectorySummaries: {} },
  );
});
test("local RPC never follows a redirect carrying the session header", async (t) => {
  let received = 0;
  const destination = await localServer(t, (_req, res) => {
    received++;
    res.end("{}");
  });
  const port = await localServer(t, (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${destination}/capture` });
    res.end();
  });
  await assert.rejects(
    postLanguageServer(
      { port, token: "fixture", secure: false },
      "GetUserStatus",
    ),
    /local-api-status/,
  );
  assert.equal(received, 0);
});
test("a peer closing mid-response is rejected instead of leaving refresh pending", async (t) => {
  const port = await localServer(t, (_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": 1000,
    });
    res.flushHeaders();
    res.write("{");
    setImmediate(() => res.destroy());
  });
  await assert.rejects(
    postLanguageServer(
      { port, token: "fixture", secure: false },
      "GetUserStatus",
    ),
    /local-api-aborted/,
  );
});
test("a slowly streaming peer cannot bypass the total request deadline", async (t) => {
  const port = await localServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write(" ");
    const timer = setInterval(() => res.write(" "), 100);
    res.on("close", () => clearInterval(timer));
  });
  const start = Date.now();
  await assert.rejects(
    postLanguageServer(
      { port, token: "fixture", secure: false },
      "GetUserStatus",
    ),
    /local-api-timeout/,
  );
  assert.ok(Date.now() - start >= 1000 && Date.now() - start < 3500);
});
test("read-only RPC rejects unknown methods and invalid ports before connecting", async () => {
  await assert.rejects(
    postLanguageServer(
      { port: 70000, token: "fixture", secure: false },
      "GetUserStatus",
    ),
    /local-api-port/,
  );
  await assert.rejects(
    postLanguageServer(
      { port: 1234, token: "fixture", secure: false },
      "DeleteCascadeTrajectory",
    ),
    /local-api-method/,
  );
});
test("oversized local replies are bounded before JSON decoding", async (t) => {
  const port = await localServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "x".repeat(4 * 1024 * 1024) }));
  });
  await assert.rejects(
    postLanguageServer(
      { port, token: "fixture", secure: false },
      "GetUserStatus",
    ),
    /local-api-too-large/,
  );
});
