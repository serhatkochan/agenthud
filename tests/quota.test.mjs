import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCursor,
  parseClaude,
  parseCodex,
  parseAntigravity,
  remaining,
  mergeRefresh,
} from "../electron/quota.mjs";

test("Cursor has independent pools and fractional percentage units", () => {
  const q = parseCursor({
    billingCycleEnd: "2026-11-01T00:00:00Z",
    individualUsage: { plan: { autoPercentUsed: 60, apiPercentUsed: 0.36 } },
  });
  assert.deepEqual(
    q.map((x) => [x.label, x.remaining]),
    [
      ["Cursor Models", 40],
      ["Other Models", 99.64],
    ],
  );
  assert.equal(q[0].resetsAt, "2026-11-01T00:00:00Z");
});
test("absent or malformed limits never imply an unused allowance", () => {
  for (const value of [null, undefined, "60", NaN, Infinity, -1, 101])
    assert.equal(remaining(value), null);
  assert.deepEqual(parseCursor({}), []);
  assert.deepEqual(parseClaude({ five_hour: { utilization: null } }), []);
});
test("zero remaining and zero used are retained for Claude and Codex", () => {
  assert.deepEqual(
    parseClaude({
      five_hour: { utilization: 100 },
      seven_day: { utilization: 0 },
    }).map((x) => x.remaining),
    [0, 100],
  );
  assert.deepEqual(
    parseCodex({
      rate_limit: {
        primary_window: { used_percent: 20, reset_at: 1800000000 },
        secondary_window: { used_percent: 100 },
      },
    }).map((x) => x.remaining),
    [80, 0],
  );
});
test("Antigravity preserves every measured group and both windows", () => {
  const q = parseAntigravity({
    quotaGroups: [
      {
        groupId: "gemini",
        groupName: "Gemini Models",
        quotaBuckets: [
          {
            bucketId: "weekly",
            remainingFraction: 0.91,
            resetTime: "2026-10-25T00:00:00Z",
          },
          { bucketId: "five_hour", remainingFraction: 0.68 },
        ],
      },
      {
        groupId: "claude",
        groupName: "Claude and GPT models",
        quotaBuckets: [
          { bucketId: "weekly", remainingFraction: 0 },
          { bucketId: "five_hour", remainingFraction: 1 },
        ],
      },
      {
        groupId: "argon",
        groupName: "Gemini 4 Argon",
        quotaBuckets: [{ bucketId: "weekly", remainingFraction: 0.31 }],
      },
    ],
  });
  assert.equal(q.length, 5);
  assert.deepEqual(
    q.map((x) => x.remaining),
    [91, 68, 0, 100, 31],
  );
  assert.equal(q[4].group, "Gemini 4 Argon");
});
test("Antigravity missing quota is unavailable and disabled measurements are explicit", () => {
  assert.deepEqual(
    parseAntigravity({
      quotaGroups: [
        {
          groupName: "Gemini",
          quotaBuckets: [
            { bucketId: "weekly" },
            { bucketId: "five_hour", remainingFraction: 1, disabled: true },
          ],
        },
      ],
    }),
    [
      {
        id: "Gemini:five_hour",
        label: "5 saatlik",
        remaining: 100,
        resetsAt: null,
        group: "Gemini",
        disabled: true,
      },
    ],
  );
});
test("Antigravity native response envelope preserves exhausted groups", () => {
  const q = parseAntigravity({
    response: {
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            {
              bucketId: "gemini-5h",
              displayName: "Five Hour Limit Remaining",
              remainingFraction: 0.65,
              window: "QUOTA_WINDOW_FIVE_HOURS",
            },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "3p-weekly", remainingFraction: 0 },
            { bucketId: "3p-5h", remainingFraction: 1, disabled: true },
          ],
        },
      ],
    },
  });
  assert.deepEqual(
    q.map((x) => [x.group, x.label, x.remaining]),
    [
      ["Gemini Models", "5 saatlik", 65],
      ["Claude and GPT models", "Haftalık", 0],
      ["Claude and GPT models", "5 saatlik", 100],
    ],
  );
});
test("transport failure preserves timestamp but auth failure clears previous quota", () => {
  const old = {
    id: "cursor",
    status: "connected",
    quotas: [{ remaining: 40 }],
    updatedAt: 100,
    account: "a",
    accountScope: "account-a",
  };
  const stale = mergeRefresh(old, {
    id: "cursor",
    status: "error",
    errorKind: "network",
    message: "offline",
    accountScope: "account-a",
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.updatedAt, 100);
  assert.equal(stale.quotas[0].remaining, 40);
  assert.equal(
    mergeRefresh(old, {
      id: "cursor",
      status: "needs-login",
      errorKind: "auth",
    }).quotas.length,
    0,
  );
  assert.equal(
    mergeRefresh(old, {
      id: "cursor",
      status: "error",
      errorKind: "network",
      accountScope: "account-b",
    }).quotas.length,
    0,
  );
  assert.equal(
    mergeRefresh(old, { id: "cursor", status: "error", errorKind: "network" })
      .quotas.length,
    0,
  );
});
