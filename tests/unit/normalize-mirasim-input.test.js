// zcode-plugin/scripts/normalize-mirasim-input.mjs must bring every OLD mirasim
// row (prompt = net-new input only) to prompt = input + cache exactly once, and
// leave every NEW row (written that way by the fixed converters) alone.
//
// Neither the flag nor "prompt >= cache" decides it on its own: CreditDaddy
// writes new rows without the flag, and on the NAS 66 of 2904 old rows had a
// net-new input larger than their cache. Old rows that were priced before
// normalization carry an estimate that billed the fresh input at nothing — the
// script clears it and drops the server's repair watermark so it is re-priced.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT = fileURLToPath(new URL("../../zcode-plugin/scripts/normalize-mirasim-input.mjs", import.meta.url));
const EXPORT = fileURLToPath(new URL("../../zcode-plugin/scripts/export-usage.mjs", import.meta.url));
const dirs = [];
afterAll(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* sqlite handle on Windows */ } });

const CACHE = 113_000_000;
const TS = "2026-09-20T10:00:00.000Z";
const PROVIDER = "mirasim-anthropic";
const MODEL = "claude-x";
const localDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** rows: [{ name, prompt, cache, call?, flagged?, cost? }] — inserted in order (ids ascend). */
function makeDb(rows, { watermark = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-mirasim-norm-"));
  dirs.push(dir);
  const dbPath = path.join(dir, "data.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, provider TEXT, model TEXT,
             connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER, tokens TEXT, meta TEXT, cost REAL DEFAULT 0);
           CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT);
           CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);`);
  if (watermark) db.prepare(`INSERT INTO _meta(key, value) VALUES('usageCostRepair', '{"version":"1.2.1","lastId":999}')`).run();
  const ins = db.prepare(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, tokens, meta, cost)
                          VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const day = { promptTokens: 0, cost: 0, byProvider: { [PROVIDER]: { promptTokens: 0, cost: 0 } },
    byModel: { [`${MODEL}|${PROVIDER}`]: { promptTokens: 0, cost: 0 } },
    byApiKey: { [`local-no-key|${MODEL}|${PROVIDER}`]: { promptTokens: 0, cost: 0 } }, byEndpoint: {} };
  for (const r of rows) {
    const cost = r.cost || 0;
    ins.run(TS, PROVIDER, MODEL, null, null, `mirasim://${r.name}`, r.prompt,
      JSON.stringify({ prompt_tokens: r.prompt, completion_tokens: 10, cache_read_input_tokens: r.cache }),
      JSON.stringify({ source: "mirasim", mirasimCallId: r.call || `call-${r.name}`, ...(r.flagged ? { mirasimInputNormalized: true } : {}) }), cost);
    for (const b of [day, day.byProvider[PROVIDER], day.byModel[`${MODEL}|${PROVIDER}`], day.byApiKey[`local-no-key|${MODEL}|${PROVIDER}`]]) {
      b.promptTokens += r.prompt; b.cost += cost;
    }
    day.byEndpoint[`mirasim://${r.name}|${MODEL}|${PROVIDER}`] = { promptTokens: r.prompt, cost };
  }
  db.prepare(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`).run(localDay(TS), JSON.stringify(day));
  db.close();
  return dbPath;
}

const run = (dbPath, ...extra) => execFileSync(process.execPath, ["--no-warnings", SCRIPT, dbPath, ...extra], { encoding: "utf8" });
function read(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = Object.fromEntries(db.prepare(`SELECT endpoint, promptTokens, tokens, cost FROM usageHistory ORDER BY id`).all()
    .map((r) => [r.endpoint.replace("mirasim://", ""), { prompt: r.promptTokens, tokenPrompt: JSON.parse(r.tokens).prompt_tokens, cost: r.cost }]));
  const day = JSON.parse(db.prepare(`SELECT data FROM usageDaily`).get().data);
  const watermark = db.prepare(`SELECT value FROM _meta WHERE key = 'usageCostRepair'`).get();
  db.close();
  return { rows, day, watermark };
}

describe("normalize-mirasim-input: which rows are old", () => {
  it("a never-normalized db: every old row gets the cache once — including one whose input exceeds its cache", () => {
    const db = makeDb([
      { name: "small-input", prompt: 638, cache: CACHE },
      { name: "big-input", prompt: 59306, cache: 17408 },   // real NAS shape: input > cache, still old
    ]);
    run(db, "--apply", "--quiet");
    const { rows, day } = read(db);
    expect(rows["small-input"]).toMatchObject({ prompt: 638 + CACHE, tokenPrompt: 638 + CACHE });
    expect(rows["big-input"]).toMatchObject({ prompt: 59306 + 17408, tokenPrompt: 59306 + 17408 });
    expect(day.promptTokens).toBe(638 + CACHE + 59306 + 17408);
    expect(run(db)).toMatch(/nothing to do/);
  });

  it("an already-migrated db: unflagged rows imported after that run are new (CreditDaddy) and stay untouched", () => {
    const db = makeDb([
      { name: "migrated", prompt: 638 + CACHE, cache: CACHE, flagged: true },
      { name: "creditdaddy", prompt: 700 + CACHE, cache: CACHE },       // after the run, no flag
      { name: "creditdaddy-small-cache", prompt: 9000, cache: 200 },
    ]);
    const out = run(db);
    expect(out).toMatch(/nothing to do/);
    run(db, "--apply", "--quiet");
    const { rows, day } = read(db);
    expect(rows.creditdaddy.prompt).toBe(700 + CACHE);                 // not 700 + 2×CACHE
    expect(rows["creditdaddy-small-cache"].prompt).toBe(9000);
    expect(day.promptTokens).toBe(638 + CACHE + 700 + CACHE + 9000);
  });

  it("a re-sync before normalizing: the new twin is skipped, the old one is reported as a duplicate, nothing double-counts", () => {
    const db = makeDb([
      { name: "old", prompt: 638, cache: CACHE, call: "c1" },
      { name: "new-twin", prompt: 638 + CACHE, cache: CACHE, call: "c1" },
      { name: "other-old", prompt: 50, cache: 1000, call: "c2" },
    ]);
    const out = run(db);
    expect(out).toMatch(/rows to normalize : 1 /);
    expect(out).toMatch(/duplicate pairs {3}: 1 /);
    run(db, "--apply", "--quiet");
    const { rows } = read(db);
    expect(rows["new-twin"].prompt).toBe(638 + CACHE);
    expect(rows.old.prompt).toBe(638);                                 // left for the dedup cleanup
    expect(rows["other-old"].prompt).toBe(1050);
  });

  it("a row still below its cache is old even when newer than the last run", () => {
    const db = makeDb([
      { name: "migrated", prompt: 638 + CACHE, cache: CACHE, flagged: true },
      { name: "late-old", prompt: 12, cache: 5000 },                    // e.g. an old plugin on another machine
    ]);
    run(db, "--apply", "--quiet");
    expect(read(db).rows["late-old"].prompt).toBe(5012);
  });
});

describe("normalize-mirasim-input: estimates computed on the old prompt", () => {
  it("clears them, takes them out of the day bucket, and drops the repair watermark", () => {
    const db = makeDb([
      { name: "priced-early", prompt: 638, cache: CACHE, cost: 12.5 },
      { name: "unpriced", prompt: 40, cache: 900 },
    ], { watermark: true });
    expect(run(db)).toMatch(/stale cost cleared: 1 rows, \$12\.5000/);
    run(db, "--apply", "--quiet");
    const { rows, day, watermark } = read(db);
    expect(rows["priced-early"]).toMatchObject({ prompt: 638 + CACHE, cost: 0 });
    expect(day.cost).toBe(0);
    expect(day.byEndpoint[`mirasim://priced-early|${MODEL}|${PROVIDER}`].cost).toBe(0);
    expect(day.byProvider[PROVIDER].cost).toBe(0);
    expect(watermark).toBeUndefined();                                // 10Router re-prices on next start
  });

  it("keeps the watermark when no estimate had to be cleared", () => {
    const db = makeDb([{ name: "unpriced", prompt: 40, cache: 900 }], { watermark: true });
    run(db, "--apply", "--quiet");
    expect(read(db).watermark).toBeDefined();
  });
});

describe("the plugin's converter", () => {
  it("writes cache-inclusive prompts and flags them", () => {
    const src = fs.readFileSync(EXPORT, "utf8");
    const at = src.indexOf("function convertMirasimRow");
    const fn = src.slice(at, src.indexOf("\nfunction", at + 10));
    expect(fn).toContain("(e.input || 0) + (e.cacheRead || 0) + (e.cacheWrite || 0)");
    expect(fn).toContain("mirasimInputNormalized: true");
  });
});
