const numeric = (v, max = 100) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
export const remaining = (v) =>
  numeric(v) ? Math.round((100 - v) * 100) / 100 : null;
const date = (v) =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const row = (id, label, used, resetsAt, group) => ({
  id,
  label,
  remaining: remaining(used),
  resetsAt: date(resetsAt),
  group,
});

export function parseCursor(data) {
  const p = data.individualUsage?.plan;
  return [
    row(
      "cursor-models",
      "Cursor Models",
      p?.autoPercentUsed,
      data.billingCycleEnd,
    ),
    row(
      "other-models",
      "Other Models",
      p?.apiPercentUsed,
      data.billingCycleEnd,
    ),
  ].filter((x) => x.remaining !== null);
}
export function parseClaude(data) {
  return [
    ["five_hour", "5 saatlik"],
    ["seven_day", "Haftalık"],
    ["seven_day_sonnet", "Sonnet · Haftalık"],
    ["seven_day_opus", "Opus · Haftalık"],
    ["seven_day_cowork", "Cowork · Haftalık"],
  ]
    .map(([id, label]) =>
      row(id, label, data[id]?.utilization, data[id]?.resets_at),
    )
    .filter((x) => x.remaining !== null);
}
export function parseCodex(data) {
  return [
    ["primary_window", "5 saatlik"],
    ["secondary_window", "Haftalık"],
  ]
    .map(([id, label]) => {
      const w = data.rate_limit?.[id];
      const reset =
        typeof w?.reset_at === "number" && Number.isFinite(w.reset_at)
          ? new Date(w.reset_at * 1000).toISOString()
          : null;
      const seconds = w?.limit_window_seconds;
      if (seconds === 2592000) label = "Aylık";
      else if (seconds === 604800) label = "Haftalık";
      else if (seconds === 18000) label = "5 saatlik";
      return row(id, label, w?.used_percent, reset);
    })
    .filter((x) => x.remaining !== null);
}
export function parseAntigravity(data) {
  const root =
    data.response ?? data.quotaSummary ?? data.userQuotaSummary ?? data;
  const groups = root.quotaGroups ?? root.groups ?? [];
  const rows = [];
  for (const g of groups)
    for (const b of g.quotaBuckets ?? g.buckets ?? []) {
      if (!numeric(b.remainingFraction, 1)) continue;
      const id = b.bucketId ?? b.name ?? String(rows.length);
      const label = /week/i.test(id + " " + b.displayName)
        ? "Haftalık"
        : /hour|session|5h/i.test(id + " " + b.displayName)
          ? "5 saatlik"
          : b.displayName || id;
      rows.push({
        ...row(
          `${g.groupId ?? g.groupName ?? g.displayName}:${id}`,
          label,
          100 - b.remainingFraction * 100,
          b.resetTime ?? b.resetTimestamp,
          g.groupName ?? g.displayName ?? g.groupId,
        ),
        ...(b.disabled ? { disabled: true } : {}),
      });
    }
  if (rows.length) return rows;
  const models =
    data.userStatus?.cascadeModelConfigData?.clientModelConfigs ??
    data.clientModelConfigs ??
    data.modelConfigs ??
    [];
  return models.flatMap((m) => {
    const q = m.quotaInfo;
    if (!numeric(q?.remainingFraction, 1)) return [];
    return [
      row(
        m.modelId ?? m.label,
        m.label ?? m.modelId,
        100 - q.remainingFraction * 100,
        q.resetTime,
        "Model limitleri",
      ),
    ];
  });
}
export function mergeRefresh(previous, next) {
  if (
    previous?.quotas?.length &&
    next.errorKind === "network" &&
    previous.accountScope &&
    previous.accountScope === next.accountScope
  )
    return { ...previous, status: "stale", message: next.message };
  return { ...next, quotas: next.quotas ?? [] };
}
