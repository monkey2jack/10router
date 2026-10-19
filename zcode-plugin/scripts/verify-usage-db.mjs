#!/usr/bin/env node
/**
 * 10Router usage database verifier.
 *
 * Checks a 10router data.sqlite for the invariants that matter when anyone
 * touches usage data by hand — it exists because a manual dedup once silently
 * corrupted two things that are easy to get wrong:
 *   1. day buckets were rebuilt with UTC dates instead of the server's LOCAL
 *      dates (on a UTC+8 host ~20% of rows land in the wrong bucket);
 *   2. the rebuild omitted three of the five aggregation dimensions.
 * Both are invisible in row counts and only surface as wrong numbers in the UI.
 *
 * Checks:
 *   - integrity_check / quick_check / foreign_key_check
 *   - row counts (usageHistory, usageDaily, _meta)
 *   - usageDaily == local-date aggregation of usageHistory, field-for-field
 *     (requests, promptTokens, completionTokens, cachedTokens, cost + all five
 *     dimensions' request counts), and no bucket exists without rows
 *   - totalRequestsLifetime == usageHistory row count
 *
 * Usage: node verify-usage-db.mjs <data.sqlite> [--json] [--quiet]
 * Exit code: 0 = all checks pass, 1 = problems found, 2 = usage error.
 *
 * Read-only: opens the database with readOnly, never writes.
 */
import { DatabaseSync } from "node:sqlite";
import { localDateKey, aggregateRowsByLocalDay, emptyDay, USAGE_HISTORY_COLUMNS } from "./usage-daily.mjs";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const quiet = args.includes("--quiet");

if (!dbPath) {
  console.error("usage: node verify-usage-db.mjs <data.sqlite> [--json] [--quiet]");
  process.exit(2);
}

const problems = [];
const notes = [];
const report = { db: dbPath, checks: {}, problems, notes };

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  // --- integrity ---------------------------------------------------------
  const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check);
  report.checks.integrity = integrity.length === 1 && integrity[0] === "ok" ? "ok" : integrity.slice(0, 5);
  if (report.checks.integrity !== "ok") problems.push(`integrity_check failed: ${JSON.stringify(integrity.slice(0, 3))}`);

  const quick = db.prepare("PRAGMA quick_check").all().map((r) => r.quick_check);
  report.checks.quickCheck = quick.length === 1 && quick[0] === "ok" ? "ok" : quick.slice(0, 5);

  const fk = db.prepare("PRAGMA foreign_key_check").all();
  report.checks.foreignKeyCheck = fk.length === 0 ? "ok" : fk.slice(0, 5);

  // --- counts ------------------------------------------------------------
  const historyRows = db.prepare(`SELECT ${USAGE_HISTORY_COLUMNS} FROM usageHistory`).all();
  const dailyRows = db.prepare("SELECT dateKey, data FROM usageDaily").all();
  report.checks.counts = {
    usageHistory: historyRows.length,
    usageDaily: dailyRows.length,
    metaRows: db.prepare("SELECT count(*) c FROM _meta").get().c,
  };

  // --- usageDaily fidelity ----------------------------------------------
  const expected = aggregateRowsByLocalDay(historyRows);
  const stored = new Map();
  for (const row of dailyRows) {
    try { stored.set(row.dateKey, JSON.parse(row.data || "{}")); }
    catch { problems.push(`usageDaily ${row.dateKey}: data is not valid JSON`); }
  }

  const fields = ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"];
  const dims = ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"];
  let perfect = 0;
  const dayProblems = [];

  for (const [key, exp] of expected) {
    const got = stored.get(key);
    if (!got) { dayProblems.push(`${key}: missing bucket (history has ${exp.requests} rows)`); continue; }
    const fieldDiff = fields.filter((f) => Math.abs((exp[f] || 0) - (got[f] || 0)) > 1e-6);
    const dimDiff = [];
    for (const dim of dims) {
      const a = exp[dim] || {}, b = got[dim] || {};
      if (dim === "byApiKey") {
        // #9 (9826b8c3): raw keys are no longer stored — the usageHistory
        // column holds the mask (first 8 chars + "***") while live buckets
        // key by sha256(raw), so per-key identity is structurally
        // unreproducible from stored data. Compare the AGGREGATE instead:
        // numeric totals stay exact, key identity for non-null keys does not.
        const sa = Object.values(a).reduce((n, c) => n + (c.requests || 0), 0);
        const sb = Object.values(b).reduce((n, c) => n + (c.requests || 0), 0);
        if (sa !== sb) dimDiff.push(`byApiKey[total] exp=${sa} got=${sb}`);
        continue;
      }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if ((a[k]?.requests || 0) !== (b[k]?.requests || 0)) {
          dimDiff.push(`${dim}:${k} exp=${a[k]?.requests || 0} got=${b[k]?.requests || 0}`);
        }
      }
    }
    if (fieldDiff.length === 0 && dimDiff.length === 0) perfect++;
    else dayProblems.push(`${key}: fields[${fieldDiff.join(",") || "-"}]${dimDiff.length ? ` dims[${dimDiff.slice(0, 2).join("; ")}]` : ""}`);
  }
  for (const key of stored.keys()) {
    if (!expected.has(key)) dayProblems.push(`${key}: bucket exists but history has 0 rows for that local day`);
  }

  report.checks.usageDailyFidelity = {
    daysInHistory: expected.size,
    daysInDaily: stored.size,
    daysPerfect: perfect,
    mismatched: dayProblems.length,
  };
  if (dayProblems.length) problems.push(...dayProblems.slice(0, 20).map((p) => `usageDaily ${p}`));

  // --- lifetime counter --------------------------------------------------
  const lifetime = db.prepare("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'").get()?.value;
  report.checks.totalRequestsLifetime = {
    stored: lifetime != null ? Number(lifetime) : null,
    usageHistoryRows: historyRows.length,
    match: lifetime != null && Number(lifetime) === historyRows.length,
  };
  if (lifetime == null) notes.push("_meta.totalRequestsLifetime absent (app recreates it on next write)");
  else if (Number(lifetime) !== historyRows.length) {
    problems.push(`totalRequestsLifetime=${lifetime} != usageHistory rows=${historyRows.length}`);
  }

  // --- provider snapshot (informational) --------------------------------
  const byProvider = {};
  for (const r of historyRows) byProvider[r.provider || "(null)"] = (byProvider[r.provider || "(null)"] || 0) + 1;
  report.checks.byProvider = Object.fromEntries(
    Object.entries(byProvider).sort((a, b) => b[1] - a[1]).slice(0, 25)
  );
} finally {
  db.close();
}

report.ok = problems.length === 0;

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else if (!quiet || !report.ok) {
  const c = report.checks;
  console.log(`database: ${dbPath}`);
  console.log(`  integrity:        ${JSON.stringify(c.integrity)}`);
  console.log(`  quick_check:      ${JSON.stringify(c.quickCheck)}`);
  console.log(`  foreign_keys:     ${JSON.stringify(c.foreignKeyCheck)}`);
  console.log(`  usageHistory:     ${c.counts.usageHistory} rows`);
  console.log(`  usageDaily:       ${c.counts.usageDaily} buckets`);
  const f = c.usageDailyFidelity;
  console.log(`  daily fidelity:   ${f.daysPerfect}/${f.daysInHistory} days perfect, ${f.mismatched} mismatched`);
  const l = c.totalRequestsLifetime;
  console.log(`  lifetime counter: ${l.stored} (history ${l.usageHistoryRows}) ${l.match ? "✓" : "✗"}`);
  for (const n of notes) console.log(`  note: ${n}`);
  if (report.ok) {
    console.log("RESULT: PASS — all invariants hold");
  } else {
    console.log(`RESULT: FAIL — ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 20)) console.log(`  - ${p}`);
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
  }
}

process.exit(report.ok ? 0 : 1);
