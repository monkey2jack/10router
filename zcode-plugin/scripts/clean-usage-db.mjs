#!/usr/bin/env node
/**
 * 10Router usage-history surgery: drop rows matching a filter and faithfully
 * rebuild the affected usageDaily buckets + the lifetime counter.
 *
 * Why this exists: imported rows can be wrong (e.g. a usage-export script that
 * double-counted a local gateway's traffic). Removing them by hand is dangerous
 * because usageDaily is maintained incrementally and nothing rebuilds it — a
 * naive DELETE leaves the dashboard reporting phantom numbers, and a naive
 * rebuild gets the local-date bucketing and the five aggregation dimensions
 * wrong. This tool does it the way the app does (see usage-daily.mjs) and
 * verifies the result before finishing.
 *
 * Usage:
 *   node clean-usage-db.mjs <data.sqlite> --provider <name> [--apply]
 *   node clean-usage-db.mjs <data.sqlite> --where "<sql>" [--apply]
 *   node clean-usage-db.mjs <data.sqlite> --provider <name> --export <file>   (backup rows to JSON first)
 *
 * Default is a DRY REPORT (no writes). --apply performs the surgery.
 * ALWAYS stop the 10Router service first, or work on a copy — the app holds the
 * database open and concurrent writers corrupt it.
 *
 * Safety rails:
 *   - refuses to run against a database that fails integrity_check
 *   - --provider matches exactly; --where is a raw predicate (use with care)
 *   - prints the affected day buckets and the counter delta before writing
 *   - after writing, re-runs the verifier's fidelity check in-process
 *
 * Exit: 0 ok, 1 verification failed or refused, 2 usage error.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { localDateKey, buildDayBucket, emptyDay, aggregateEntryToDay, USAGE_HISTORY_COLUMNS } from "./usage-daily.mjs";

const argv = process.argv.slice(2);
const dbPath = argv.find((a) => !a.startsWith("--"));
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
const apply = has("--apply");
const provider = flag("--provider");
const whereRaw = flag("--where");
const exportFile = flag("--export");

if (!dbPath || (!provider && !whereRaw)) {
  console.error(`usage: node clean-usage-db.mjs <data.sqlite> --provider <name> [--apply] [--export <file>]
       node clean-usage-db.mjs <data.sqlite> --where "<sql predicate>" [--apply]`);
  process.exit(2);
}
if (!fs.existsSync(dbPath)) { console.error(`error: ${dbPath} not found`); process.exit(2); }

const predicate = provider ? "provider = ?" : whereRaw;
const params = provider ? [provider] : [];
const describe = provider ? `provider = ${JSON.stringify(provider)}` : `where ${whereRaw}`;

const db = new DatabaseSync(dbPath);

// --- refuse to operate on a damaged database ----------------------------
const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check);
if (!(integrity.length === 1 && integrity[0] === "ok")) {
  console.error("error: database fails integrity_check — repair or restore a backup first.");
  console.error(`  ${JSON.stringify(integrity.slice(0, 3))}`);
  process.exit(1);
}

// --- what would go ------------------------------------------------------
const targets = db.prepare(`SELECT ${USAGE_HISTORY_COLUMNS} FROM usageHistory WHERE ${predicate}`).all(...params);
console.log(`match: ${describe}`);
console.log(`rows: ${targets.length}`);
if (targets.length === 0) { console.log("nothing to do"); process.exit(0); }

const promptSum = targets.reduce((a, r) => a + (r.promptTokens || 0), 0);
const completionSum = targets.reduce((a, r) => a + (r.completionTokens || 0), 0);
console.log(`tokens: ${promptSum} prompt / ${completionSum} completion`);

const touched = new Set(targets.map((r) => localDateKey(r.timestamp)));
console.log(`local days to rebuild: ${touched.size} (${[...touched].sort().join(", ")})`);

if (exportFile) {
  fs.writeFileSync(exportFile, JSON.stringify({ exportedAt: new Date().toISOString(), filter: describe, rows: targets }, null, 2));
  console.log(`rows backed up to ${exportFile}`);
}

if (!apply) {
  console.log("(dry report — pass --apply to perform the surgery)");
  process.exit(0);
}

// --- surgery ------------------------------------------------------------
db.exec("BEGIN");
db.prepare(`DELETE FROM usageHistory WHERE ${predicate}`).run(...params);

const putDay = db.prepare(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`);
const delDay = db.prepare(`DELETE FROM usageDaily WHERE dateKey = ?`);

let rebuilt = 0;
for (const day of touched) {
  const [y, m, d] = day.split("-").map(Number);
  const startUtc = new Date(y, m - 1, d, 0, 0, 0).toISOString();
  const endUtc = new Date(y, m - 1, d + 1, 0, 0, 0).toISOString();
  const rows = db.prepare(`SELECT ${USAGE_HISTORY_COLUMNS} FROM usageHistory WHERE timestamp >= ? AND timestamp < ?`).all(startUtc, endUtc)
    .filter((r) => localDateKey(r.timestamp) === day);
  if (rows.length === 0) { delDay.run(day); console.log(`  ${day}: emptied -> bucket removed`); continue; }
  putDay.run(day, JSON.stringify(buildDayBucket(rows)));
  rebuilt++;
  console.log(`  ${day}: rebuilt from ${rows.length} rows`);
}

const meta = db.prepare("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'").get();
if (meta) {
  const next = Math.max(0, parseInt(meta.value, 10) - targets.length);
  db.prepare("INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(next));
  console.log(`totalRequestsLifetime: ${meta.value} -> ${next}`);
} else {
  console.log("note: no totalRequestsLifetime row (app recreates it)");
}
db.exec("COMMIT");

// --- verify in-process ---------------------------------------------------
const remaining = db.prepare(`SELECT count(*) c FROM usageHistory WHERE ${predicate}`).get(...params).c;
const historyRows = db.prepare(`SELECT ${USAGE_HISTORY_COLUMNS} FROM usageHistory`).all();
let mismatched = 0;
for (const day of touched) {
  const exp = buildDayBucket(historyRows.filter((r) => localDateKey(r.timestamp) === day));
  const row = db.prepare("SELECT data FROM usageDaily WHERE dateKey = ?").get(day);
  if (!row) { mismatched++; continue; }
  const got = JSON.parse(row.data);
  for (const f of ["requests", "promptTokens", "completionTokens", "cachedTokens", "cost"]) {
    if (Math.abs((exp[f] || 0) - (got[f] || 0)) > 1e-6) { mismatched++; break; }
  }
}
db.close();

console.log(`done: removed ${targets.length} rows (remaining matching: ${remaining}), rebuilt ${rebuilt} buckets`);
if (mismatched > 0) {
  console.error(`VERIFY FAILED: ${mismatched}/${touched.size} rebuilt buckets do not match usageHistory`);
  console.error("Restore from your backup and investigate before starting the service.");
  process.exit(1);
}
console.log("verify: rebuilt buckets match usageHistory ✓");
console.log("next: run verify-usage-db.mjs for the full check, then start the service.");
