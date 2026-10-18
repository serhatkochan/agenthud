import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { win32 } from "node:path";
import { flag } from "./system.mjs";

const methods = new Set([
  "GetAllCascadeTrajectories",
  "RetrieveUserQuotaSummary",
  "GetUserStatus",
  "GetCommandModelConfigs",
]);
const validPort = (port) => Number.isInteger(port) && port > 0 && port <= 65535;

export function languageServers(system) {
  return system.processes
    .filter(
      (p) =>
        /language.?server/i.test(p.Name) &&
        /antigravity/i.test(
          (p.CommandLine ?? "") + " " + (p.ExecutablePath ?? ""),
        ),
    )
    .map((p) => {
      const token = flag(p.CommandLine, "csrf_token");
      if (!token) return { pid: p.ProcessId, targets: [] };
      const ports = [
        ...new Set(
          system.listeners
            .filter((l) => l.pid === p.ProcessId && validPort(l.port))
            .map((l) => l.port),
        ),
      ].slice(0, 12);
      const targets = ports.map((port) => ({ port, token, secure: true }));
      const fallback = Number(flag(p.CommandLine, "extension_server_port"));
      if (validPort(fallback))
        targets.push({
          port: fallback,
          token: flag(p.CommandLine, "extension_server_csrf_token") ?? token,
          secure: false,
        });
      return { pid: p.ProcessId, targets };
    });
}
export async function postLanguageServer(
  { port, token, secure = true },
  method,
) {
  if (!validPort(port)) throw new Error("local-api-port");
  if (!methods.has(method)) throw new Error("local-api-method");
  return new Promise((resolve, reject) => {
    let finished = false;
    const settle = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      error ? reject(error) : resolve(result);
    };
    const body = JSON.stringify({
      metadata: {
        ideName: "antigravity",
        extensionName: "antigravity",
        ideVersion: "unknown",
        locale: "en",
      },
    });
    const req = (secure ? https : http).request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": token,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          const error = new Error(`local-api-status-${res.statusCode}`);
          settle(error);
          res.destroy();
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) {
            const error = new Error("local-api-too-large");
            settle(error);
            req.destroy(error);
          } else chunks.push(chunk);
        });
        res.on("aborted", () => settle(new Error("local-api-aborted")));
        res.on("error", (error) => settle(error));
        res.on("end", () => {
          try {
            settle(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            settle(new Error("local-api-json"));
          }
        });
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("local-api-timeout")),
      1600,
    );
    req.on("error", (error) => settle(error));
    req.end(body);
  });
}
const statuses = {
  CASCADE_RUN_STATUS_IDLE: ["idle", "Boşta"],
  CASCADE_RUN_STATUS_RUNNING: ["working", "Çalışıyor"],
  CASCADE_RUN_STATUS_BUSY: ["working", "Meşgul"],
  CASCADE_RUN_STATUS_CANCELING: ["unknown", "Durduruluyor"],
};
export function hasTrajectories(data) {
  const value = data?.trajectorySummaries;
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function workspace(record) {
  const roots = [
    ...(Array.isArray(record.workspaces) ? record.workspaces : []),
    ...(Array.isArray(record.trajectoryMetadata?.workspaces)
      ? record.trajectoryMetadata.workspaces
      : []),
  ].map((w) => w?.workspaceFolderAbsoluteUri);
  roots.push(
    ...(Array.isArray(record.trajectoryMetadata?.workspaceUris)
      ? record.trajectoryMetadata.workspaceUris
      : []),
  );
  for (const root of roots)
    try {
      const uri = new URL(root);
      if (uri.protocol === "file:") return fileURLToPath(uri);
    } catch {}
  return "";
}
export function parseAntigravitySessions(data, { now = Date.now() } = {}) {
  if (!hasTrajectories(data)) return [];
  return Object.entries(data.trajectorySummaries).flatMap(([id, record]) => {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      !/^[\w.:-]{1,160}$/.test(id)
    )
      return [];
    const [state, statusLabel] =
      typeof record.status === "string" &&
      Object.hasOwn(statuses, record.status)
        ? statuses[record.status]
        : ["unknown", "Durum bilinmiyor"];
    const cwd = workspace(record);
    const timestamp =
      typeof record.lastModifiedTime === "string"
        ? Date.parse(record.lastModifiedTime)
        : NaN;
    return [
      {
        id: `antigravity:${id}`,
        provider: "antigravity",
        project: cwd ? win32.basename(cwd) : "Antigravity oturumu",
        cwd,
        state,
        statusLabel,
        source: "Antigravity · yerel servis",
        updatedAt: Number.isFinite(timestamp) ? timestamp : 0,
        observedAt: now,
      },
    ];
  });
}
export async function readAntigravitySessions(system) {
  const outcomes = await Promise.all(
    languageServers(system).map(async (server) => {
      try {
        return await Promise.any(
          server.targets.map(async (target) => {
            const data = await postLanguageServer(
              target,
              "GetAllCascadeTrajectories",
            );
            if (!hasTrajectories(data)) throw new Error("local-api-schema");
            return parseAntigravitySessions(data);
          }),
        );
      } catch {
        return null;
      }
    }),
  );
  const sessions = outcomes.filter(Boolean).flat();
  const unique = new Map();
  for (const session of sessions) {
    const previous = unique.get(session.id);
    if (!previous || session.updatedAt > previous.updatedAt)
      unique.set(session.id, session);
  }
  return [...unique.values()];
}
