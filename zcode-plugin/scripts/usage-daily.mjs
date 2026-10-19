/**
 * Shared helpers for 10Router's usageDaily aggregation contract.
 *
 * usageDaily day-buckets are maintained incrementally by the app
 * (usageRepo.aggregateEntryToDay, at write/import time); nothing rebuilds them
 * from scratch. These helpers reproduce that contract exactly so tooling can
 * verify buckets (verify-usage-db.mjs) or rebuild them faithfully after manual
 * surgery (clean-usage-db.mjs).
 *
 * Contract (verified against a live DB — 56/56 days match field-for-field):
 *   - buckets are keyed by the timestamp's LOCAL date (server timezone), NOT
 *     the UTC date part — on a UTC+8 host those differ for ~20% of rows
 *   - five dimensions: byProvider / byModel / byAccount / byApiKey / byEndpoint
 *   - cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens
 *   - byApiKey: since server commit 9826b8c3 (#9, raw keys no longer stored)
 *     the COLUMN holds the mask (first 8 chars + "***") while the server's
 *     live bucket key embeds sha256(raw) — the raw value is gone, so tooling
 *     CANNOT reproduce live key identity from stored data. Rebuilds key by
 *     the column value (mask form, "local-no-key" when null); numeric
 *     aggregates stay exact, key identity for non-null keys does not —
 *     verify-usage-db therefore aggregate-compares this one dim.
 *
 * Keep in sync with src/lib/db/repos/usageRepo.js in the 10router repo.
 */

// Port of src/lib/db/crypto/apiKeyIdentity.js maskApiKey (keep in sync).
// Works for both raw keys and already-masked column values (idempotent).
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

export function localDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function emptyDay() {
  return {
    requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
  };
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

// Exact port of usageRepo.aggregateEntryToDay.
// NOTE: `entry.tokens` must be an OBJECT — callers holding the raw DB column
// must JSON.parse it first (a raw JSON string silently aggregates zero tokens).
export function aggregateEntryToDay(day, entry) {
  const tokens = entry.tokens || {};
  const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  addToCounter(day.byApiKey, `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`, {
    ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKeyMasked: maskApiKey(entry.apiKey) },
  });

  addToCounter(day.byEndpoint, `${entry.endpoint || "Unknown"}|${entry.model}|${entry.provider || "unknown"}`, {
    ...vals, meta: { endpoint: entry.endpoint, rawModel: entry.model, provider: entry.provider },
  });
}

export function parseTokensColumn(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export const USAGE_HISTORY_COLUMNS =
  "timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, tokens";

// Rows of one LOCAL day. Fetches a UTC window around it (index-friendly), then
// keeps exact local-date matches.
export function selectDayRows(db, day) {
  const [y, m, d] = day.split("-").map(Number);
  const startUtc = new Date(y, m - 1, d, 0, 0, 0).toISOString();
  const endUtc = new Date(y, m - 1, d + 1, 0, 0, 0).toISOString();
  const rows = db.prepare(
    `SELECT ${USAGE_HISTORY_COLUMNS} FROM usageHistory WHERE timestamp >= ? AND timestamp < ?`
  ).all(startUtc, endUtc);
  return rows.filter((r) => localDateKey(r.timestamp) === day);
}

export function buildDayBucket(rows) {
  const day = emptyDay();
  for (const r of rows) aggregateEntryToDay(day, { ...r, tokens: parseTokensColumn(r.tokens) });
  return day;
}

// Group every row into its LOCAL day bucket.
export function aggregateRowsByLocalDay(rows) {
  const days = new Map();
  for (const r of rows) {
    const key = localDateKey(r.timestamp);
    let day = days.get(key);
    if (!day) { day = emptyDay(); days.set(key, day); }
    aggregateEntryToDay(day, { ...r, tokens: parseTokensColumn(r.tokens) });
  }
  return days;
}
