import test from "node:test";
import assert from "node:assert/strict";
import { parseAntigravitySessions } from "../electron/antigravity-client.mjs";

const envelope = (records) => ({
  trajectorySummaries: Object.fromEntries(
    records.map((record, index) => [`session-${index}`, record]),
  ),
});
const record = (status, extra = {}) => ({
  status,
  lastModifiedTime: "2026-10-18T04:14:26Z",
  workspaces: [{ workspaceFolderAbsoluteUri: "file:///c:/ex/My%20project" }],
  ...extra,
});

test("a real idle trajectory maps to its project without claiming completion", () => {
  const [session] = parseAntigravitySessions(
    envelope([
      record("CASCADE_RUN_STATUS_IDLE", {
        summary: "PRIVATE PROMPT",
        annotations: { title: "PRIVATE TITLE" },
        token: "PRIVATE TOKEN",
      }),
    ]),
    { now: 1800000000000 },
  );
  assert.ok(session);
  assert.equal(session.provider, "antigravity");
  assert.equal(session.project, "My project");
  assert.equal(session.cwd, "c:\\ex\\My project");
  assert.equal(session.state, "idle");
  assert.equal(session.updatedAt, 1792296866000);
  assert.equal(session.observedAt, 1800000000000);
  assert.equal(JSON.stringify(session).includes("PRIVATE"), false);
});
test("only known provider statuses receive activity labels", () => {
  const rows = parseAntigravitySessions(
    envelope(
      [
        "RUNNING",
        "BUSY",
        "CANCELING",
        "UNSPECIFIED",
        "WAITING_FOR_APPROVAL",
      ].map((s) => record(`CASCADE_RUN_STATUS_${s}`)),
    ),
  );
  assert.deepEqual(
    rows.map((s) => [s.state, s.statusLabel]),
    [
      ["working", "Çalışıyor"],
      ["working", "Meşgul"],
      ["unknown", "Durduruluyor"],
      ["unknown", "Durum bilinmiyor"],
      ["unknown", "Durum bilinmiyor"],
    ],
  );
  assert.equal(
    rows.some((s) => s.state === "blocked"),
    false,
  );
});
test("inherited object names cannot act as provider statuses", () => {
  const rows = parseAntigravitySessions(
    envelope([
      record("constructor"),
      record("toString"),
      record({ kind: "RUNNING" }),
    ]),
  );
  assert.equal(rows.length, 3);
  assert.equal(
    rows.every((s) => s.state === "unknown"),
    true,
  );
});
test("missing or malformed trajectory envelopes do not fabricate sessions", () => {
  for (const data of [
    null,
    undefined,
    {},
    { trajectorySummaries: null },
    { trajectorySummaries: [] },
    { trajectorySummaries: { bad: null, other: "not-a-record" } },
  ])
    assert.deepEqual(parseAntigravitySessions(data), []);
});
test("workspace metadata fallback accepts file URIs and ignores web addresses", () => {
  const rows = parseAntigravitySessions(
    envelope([
      record("CASCADE_RUN_STATUS_IDLE", {
        workspaces: [],
        trajectoryMetadata: {
          workspaceUris: ["file:///c:/ex/T%C3%BCrk%C3%A7e"],
        },
      }),
      record("CASCADE_RUN_STATUS_IDLE", {
        workspaces: [
          { workspaceFolderAbsoluteUri: "https://example.com/private" },
        ],
      }),
    ]),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cwd, "c:\\ex\\Türkçe");
  assert.equal(rows[1].cwd, "");
  assert.equal(rows[1].project, "Antigravity oturumu");
});
test("invalid timestamps stay unknown and session IDs stay stable across refreshes", () => {
  const data = envelope([
    record("CASCADE_RUN_STATUS_IDLE", { lastModifiedTime: "not-a-date" }),
  ]);
  const a = parseAntigravitySessions(data, { now: 100 });
  const b = parseAntigravitySessions(data, { now: 200 });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].id, b[0].id);
  assert.equal(a[0].updatedAt, 0);
  assert.equal(b[0].observedAt, 200);
});
