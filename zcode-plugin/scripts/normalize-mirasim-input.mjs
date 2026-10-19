#!/usr/bin/env node
/**
 * normalize-mirasim-input.mjs — one-shot correction of imported mirasim rows
 * whose prompt_tokens excluded cache (the old converter reported mirasim's
 * `input` field verbatim, but mirasim logs input as NET-NEW only: cacheRead /
 * cacheWrite live in separate fields — verified anthropic sum(input)=110K vs
 * sum(cacheRead)=471M, openai-chat 16.5M vs 123M, openai-responses 5.8M vs
 * 145M). The converter now reports prompt = input + cacheRead + cacheWrite;
 * this script brings ALREADY-IMPORTED rows to the same convention so that a
 * re-sync dedups instead of duplicating (signature includes promptTokens).
 *
 * Which rows are OLD (net-new prompt) and get the cache added. Rows written by
 * a fixed converter (this plugin's export-usage ≥ v1.5.0, CreditDaddy's usage
 * sync) already carry prompt = input + cache; CreditDaddy never sets the flag,
 * and both converters write the same meta as the old one — adding the cache to
 * those would double-count it (638 + 113M → 638 + 226M). Neither "flag" nor
 * "prompt >= cache" alone decides it: on the NAS 66 of 2904 old rows had a
 * net-new input larger than their cache, and skipping them would also keep
 * them out of step with the converter, so a re-sync duplicates them. Decision,
 * per mirasim row with cache (cache = cacheRead + cacheWrite, p = promptTokens):
 *   1. flagged                                 → done, skip
 *   2. p <  cache (and no twin, see 3–4)       → OLD (a new row cannot be below its cache)
 *   3. a same-mirasimCallId row has p - cache  → NEW, skip (its old twin is the one to fix)
 *   4. a same-mirasimCallId row has p + cache  → OLD whose new twin is already
 *      imported — normalizing would make an exact duplicate; skipped and
 *      reported as a duplicate pair to clean up (AGENTS.md dedup recipe)
 *   5. the db was normalized before and id > the largest flagged id
 *                                              → NEW (imported after that run), skip
 *   6. otherwise                               → OLD (pre-upgrade history)
 *
 * What it changes per normalized row:
 *   - usageHistory.promptTokens  += cache_read + cache_creation
 *   - usageHistory.tokens.prompt_tokens = same new value
 *   - usageHistory.meta.mirasimInputNormalized = true   (idempotency flag)
 *   - usageHistory.cost = 0 when it was > 0. mirasim rows are exported at
 *     cost 0, so a cost here is the server's estimate — computed while prompt
 *     still excluded cache, which bills the fresh input at nothing. The script
 *     has no price table, so it clears the estimate (and its day-bucket share)
 *     and deletes the server's cost-repair watermark (_meta usageCostRepair):
 *     the next 10Router start re-prices these rows from the corrected tokens.
 *
 * Then DELTA-PATCHES the touched usageDaily buckets (top-level promptTokens +
 * the byProvider/byModel/byApiKey/byEndpoint/byAccount counters those rows
 * contribute to). Deliberately NOT a full bucket rebuild: only promptTokens
 * moves, everything else stays byte-identical — no risk of re-keying
 * counters (the plugin mirror's byApiKey key format diverges from the server
 * for non-null keys; mirasim rows always carry apiKey=null, whose key format
 * is identical on both sides: `local-no-key|<model>|<provider>`).
 *
 * requests/cachedTokens/completionTokens and the lifetime counter are untouched
 * (no row added or removed); cost moves only as described above.
 *
 * Usage:
 *   node normalize-mirasim-input.mjs /path/to/data.sqlite            # dry-run
 *   node normalize-mirasim-input.mjs /path/to/data.sqlite --apply    # write
 *
 * Back up the db (copy data.sqlite + -wal + -shm) before --apply, and run
 * verify-usage-db.mjs afterwards. WAL databases allow a short concurrent
 * write window, but a backup is still the rollback path.
 * Exit codes: 0 ok · 1 row/day problems (refuses to apply) · 2 bad args.
 */

import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const FLAG = "mirasimInputNormalized";

const args = { dbPath: null, apply: false, quiet: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node normalize-mirasim-input.mjs <data.sqlite> [--apply] [--quiet]

Dry-run by default; --apply writes. Back up the db first, verify after.`);
      process.exit(0);
    } else if (!args.dbPath && !a.startsWith("-")) args.dbPath = a;
    else { console.error(`error: unknown argument ${a}`); process.exit(2); }
  }
}
if (!args.dbPath) { console.error("error: missing <data.sqlite>"); process.exit(2); }
const log = (...m) => { if (!args.quiet) console.log(...m); };

// ── helpers (mirror server usageRepo.aggregateEntryToDay key formulas) ──────

function hashApiKey(key) {
  if (!key || typeof key !== "string") return null;
  return crypto.createHash("sha256").update(key).digest("hex");
}

function localDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

// The day-bucket counters one row contributes a promptTokens delta to.
// Mirrors src/lib/db/repos/usageRepo.js aggregateEntryToDay exactly.
function counterKeys(row) {
  const model = row.model || "unknown";
  const provider = row.provider || "unknown";
  const out = [];
  if (row.provider) out.push(["byProvider", row.provider]);
  out.push(["byModel", row.provider ? `${model}|${row.provider}` : model]);
  if (row.connectionId) out.push(["byAccount", row.connectionId]);
  out.push(["byApiKey", `${hashApiKey(row.apiKey) || "local-no-key"}|${model}|${provider}`]);
  out.push(["byEndpoint", `${row.endpoint || "Unknown"}|${model}|${provider}`]);
  return out;
}

// ── load & plan ─────────────────────────────────────────────────────────────

const db = new DatabaseSync(args.dbPath, args.apply ? {} : { readOnly: true });
if (args.apply) db.exec("PRAGMA busy_timeout = 10000");

let rows;
try {
  rows = db.prepare(
    `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, tokens, meta, cost
     FROM usageHistory WHERE provider LIKE 'mirasim-%' ORDER BY id`
  ).all();
} catch (e) {
  console.error(`error: cannot read usageHistory: ${e.message}`);
  process.exit(1);
}

const cacheOf = (t) => (t.cache_read_input_tokens || 0) + (t.cache_creation_input_tokens || 0);
const parsed = rows.map((r) => ({ r, meta: parseJson(r.meta), t: parseJson(r.tokens) }));
const maxFlaggedId = parsed.reduce((m, x) => (x.meta[FLAG] ? Math.max(m, x.r.id) : m), 0);
// mirasimCallId → promptTokens of every row carrying it (twins from a re-sync).
const promptsByCall = new Map();
for (const x of parsed) {
  const id = x.meta.mirasimCallId;
  if (!id) continue;
  if (!promptsByCall.has(id)) promptsByCall.set(id, []);
  promptsByCall.get(id).push({ rowId: x.r.id, p: x.r.promptTokens || 0 });
}
const twinWith = (x, p) => (promptsByCall.get(x.meta.mirasimCallId) || []).some((o) => o.rowId !== x.r.id && o.p === p);

const pending = [];
let alreadyFlagged = 0;
let alreadyIncluded = 0;
const duplicatePairs = [];
for (const x of parsed) {
  const { r, meta, t } = x;
  if (meta[FLAG]) { alreadyFlagged++; continue; }
  const delta = cacheOf(t);
  const p = r.promptTokens || 0;
  if (delta > 0) {
    // Twins first: an old row whose new twin is already imported usually sits
    // below its cache, and rule 2 would turn it into an exact duplicate.
    if (p >= delta && twinWith(x, p - delta)) { alreadyIncluded++; continue; }                 // rule 3
    if (twinWith(x, p + delta)) { duplicatePairs.push(r.id); continue; }                       // rule 4
    if (p >= delta && maxFlaggedId && r.id > maxFlaggedId) { alreadyIncluded++; continue; }   // rule 5
  }
  const newPrompt = p + delta;                                                   // rules 2 / 6
  pending.push({
    row: r,
    delta,
    newPrompt,
    staleCost: r.cost > 0 && delta > 0 ? r.cost : 0,
    newTokens: { ...t, prompt_tokens: newPrompt },
    newMeta: { ...meta, [FLAG]: true },
  });
}

if (pending.length === 0) {
  log(`nothing to do (${rows.length} mirasim rows: ${alreadyFlagged} flagged, ${alreadyIncluded} already include cache, ${duplicatePairs.length} duplicate pairs)`);
  if (duplicatePairs.length) log(`  duplicate pairs (old row ids, new twin already imported): ${duplicatePairs.slice(0, 20).join(", ")} — clean up, see AGENTS.md`);
  db.close();
  process.exit(0);
}

// Group deltas per touched local day + counter. Separator \x00 cannot appear
// in provider/model/endpoint values, unlike '|' which they can.
const dayDeltas = new Map(); // dayKey -> { prompt, cost, counters: Map<`dim\x00key`, { prompt, cost }> }
let totalDelta = 0;
let totalStaleCost = 0;
let staleCostRows = 0;
for (const p of pending) {
  totalDelta += p.delta;
  totalStaleCost += p.staleCost;
  if (p.staleCost) staleCostRows++;
  const dayKey = localDateKey(p.row.timestamp);
  let d = dayDeltas.get(dayKey);
  if (!d) { d = { prompt: 0, cost: 0, counters: new Map() }; dayDeltas.set(dayKey, d); }
  d.prompt += p.delta;
  d.cost -= p.staleCost;
  if (p.delta === 0) continue; // zero-delta rows only need the flag
  for (const [dim, key] of counterKeys(p.row)) {
    const ck = `${dim}\x00${key}`;
    const c = d.counters.get(ck) || { prompt: 0, cost: 0 };
    c.prompt += p.delta;
    c.cost -= p.staleCost;
    d.counters.set(ck, c);
  }
}

// Preflight: every touched day must have a bucket, else refuse (apply would
// leave fidelity broken with nothing to patch into).
const missingDays = [];
for (const dayKey of dayDeltas.keys()) {
  const exists = db.prepare(`SELECT 1 FROM usageDaily WHERE dateKey = ?`).get(dayKey);
  if (!exists) missingDays.push(dayKey);
}
if (missingDays.length > 0) {
  console.error(`error: no usageDaily bucket for ${missingDays.length} touched day(s): ${missingDays.slice(0, 10).join(", ")}`);
  console.error("refusing to apply — investigate first (verify-usage-db.mjs shows day fidelity).");
  db.close();
  process.exit(1);
}

log(`mirasim input normalization ${args.apply ? "APPLY" : "dry-run"} on ${args.dbPath}`);
const flagOnly = pending.filter((p) => p.delta === 0).length;
log(`  rows to normalize : ${pending.length - flagOnly}  (already flagged: ${alreadyFlagged}, already include cache: ${alreadyIncluded}, total mirasim rows: ${rows.length})`);
if (flagOnly) log(`  flag only         : ${flagOnly} rows without cache — tokens unchanged, just marked done`);
log(`  stale cost cleared: ${staleCostRows} rows, $${totalStaleCost.toFixed(4)} (re-priced by 10Router on next start)`);
if (duplicatePairs.length) {
  log(`  duplicate pairs   : ${duplicatePairs.length} old rows whose new twin is already imported — skipped; clean up (AGENTS.md dedup recipe)`);
  log(`                      old row ids: ${duplicatePairs.slice(0, 20).join(", ")}${duplicatePairs.length > 20 ? ", …" : ""}`);
}
log(`  promptTokens delta: ${totalDelta.toLocaleString("en-US")}`);
log(`  days touched      : ${dayDeltas.size}`);
for (const p of pending.slice(0, 3)) {
  log(`  sample: id=${p.row.id} ${p.row.promptTokens} -> ${p.newPrompt} (+${p.delta})`);
}

if (!args.apply) {
  log("dry-run only — re-run with --apply to write (back up the db first)");
  db.close();
  process.exit(0);
}

// ── apply (single transaction) ──────────────────────────────────────────────

const upd = db.prepare(`UPDATE usageHistory SET promptTokens = ?, tokens = ?, meta = ?, cost = ? WHERE id = ?`);
const getDay = db.prepare(`SELECT data FROM usageDaily WHERE dateKey = ?`);
const putDay = db.prepare(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`);

let patchedCounters = 0;
const missingCounters = [];
db.exec("BEGIN");
try {
  for (const p of pending) {
    upd.run(p.newPrompt, JSON.stringify(p.newTokens), JSON.stringify(p.newMeta), p.staleCost ? 0 : p.row.cost, p.row.id);
  }
  for (const [dayKey, d] of dayDeltas) {
    if (d.prompt === 0 && d.cost === 0 && d.counters.size === 0) continue; // flag-only day
    const row = getDay.get(dayKey);
    const data = parseJson(row.data);
    data.promptTokens = (data.promptTokens || 0) + d.prompt;
    if (d.cost) data.cost = Math.max(0, (data.cost || 0) + d.cost);
    for (const [ck, delta] of d.counters) {
      const sep = ck.indexOf("\x00");
      const dim = ck.slice(0, sep);
      const key = ck.slice(sep + 1);
      const counter = data[dim] && data[dim][key];
      if (counter) {
        counter.promptTokens = (counter.promptTokens || 0) + delta.prompt;
        if (delta.cost) counter.cost = Math.max(0, (counter.cost || 0) + delta.cost);
        patchedCounters++;
      } else missingCounters.push(`${dayKey} ${dim}[${key}]`);
    }
    putDay.run(dayKey, JSON.stringify(data));
  }
  if (missingCounters.length > 0) {
    throw new Error(`${missingCounters.length} counter key(s) missing in day buckets (first: ${missingCounters[0]})`);
  }
  // Cleared estimates must be re-priced: drop the server's repair watermark so
  // its next start scans everything again (it skips rows it has already seen).
  if (staleCostRows > 0) {
    try { db.prepare(`DELETE FROM _meta WHERE key = 'usageCostRepair'`).run(); } catch { /* pre-1.2.1 db: no watermark */ }
  }
  db.exec("COMMIT");
} catch (e) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  console.error(`error: ${e.message} — rolled back, nothing written`);
  db.close();
  process.exit(1);
}

db.close();
log(`applied: ${pending.length} rows normalized, ${dayDeltas.size} day buckets patched (${patchedCounters} counters)`);
if (staleCostRows > 0) log(`cleared ${staleCostRows} stale cost estimates — restart 10Router to re-price them`);
log(`next: node verify-usage-db.mjs ${path.resolve(args.dbPath)}   # expect PASS`);
log(`note: historical rows now match the converter's new convention — a re-sync`);
log(`      must show only genuinely-new rows as imported, all old ones skipped.`);
