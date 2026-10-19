// getUsageDashboard compares this instance's own traffic only: rows stamped
// meta.imported = true (9r backups / ZCode sync via importUsageRows) must not
// leak into node/model scores. Exception: meta.gatewaySync = true marks rows
// that were NATIVE observations on a sibling 10Router/9Router instance —
// their status is a real gateway outcome, so they DO participate. The daily
// activity series intentionally keeps everything — the heatmap reflects all
// traffic including imports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let usageRepo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-dashboard-import-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
});

afterAll(() => {
  // Best-effort: sqlite handles can lag release on Windows, EPERM on rmSync
  // is a cleanup race, not a test failure.
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const todayIso = () => new Date().toISOString();

const LIVE_ROW = {
  timestamp: todayIso(),
  provider: "acme",
  model: "acme-1",
  connectionId: "conn-live",
  status: "ok",
  tokens: { prompt_tokens: 100, completion_tokens: 50 },
};

const IMPORTED_ROW = {
  timestamp: todayIso(),
  provider: "acme",
  model: "acme-1",
  connectionId: "conn-live",
  apiKey: null,
  endpoint: "zcode://zcode-agent",
  promptTokens: 9000,
  completionTokens: 900,
  cost: 0,
  status: "ok",
  tokens: { prompt_tokens: 9000, completion_tokens: 900 },
  meta: {},
};

describe("getUsageDashboard imported-row handling", () => {
  it("imported row is excluded from scores but counted in daily", async () => {
    await usageRepo.saveRequestUsage({ ...LIVE_ROW });
    const { imported } = await usageRepo.importUsageRows([{ ...IMPORTED_ROW }]);
    expect(imported).toBe(1);

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });

    const node = dash.nodes.find((n) => n.provider === "acme");
    expect(node).toBeTruthy();
    expect(node.requests).toBe(1);
    expect(node.promptTokens).toBe(100);

    const model = dash.models.find((m) => m.provider === "acme" && m.model === "acme-1");
    expect(model).toBeTruthy();
    expect(model.requests).toBe(1);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const localDayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const day = dash.daily.find((d) => d.date === localDayKey);
    expect(day).toBeTruthy();
    expect(day.requests).toBe(2);
    expect(day.tokens).toBe(150 + 9900);

    expect(dash.lifetime.totalTokens).toBeGreaterThan(0);
    expect(dash.lifetime.peakTokens).toBeGreaterThan(0);
    expect(dash.lifetime.currentStreak).toBeGreaterThanOrEqual(1);
    expect(dash.lifetime.longestStreak).toBeGreaterThanOrEqual(1);
  });

  it("imported-only provider disappears from scores but stays in daily", async () => {
    const { imported } = await usageRepo.importUsageRows([{
      ...IMPORTED_ROW,
      provider: "ghost",
      model: "ghost-1",
      connectionId: null,
      timestamp: "2026-09-01T10:00:00.000Z",
    }]);
    expect(imported).toBe(1);

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    expect(dash.nodes.find((n) => n.provider === "ghost")).toBeUndefined();
    expect(dash.models.find((m) => m.provider === "ghost")).toBeUndefined();

    const day = dash.daily.find((d) => d.date === "2026-09-01");
    expect(day).toBeTruthy();
    expect(day.requests).toBe(1);
  });

  it("gateway-synced import (meta.gatewaySync) participates in scores and daily", async () => {
    const { imported } = await usageRepo.importUsageRows([{
      ...IMPORTED_ROW,
      provider: "gwpeer",
      model: "gwpeer-1",
      connectionId: null,
      endpoint: "https://peer.example.com/v1",
      timestamp: todayIso(), // node health uses a fixed trailing-7d window
      status: "error", // a real gateway outcome must survive into the score
      meta: { gatewaySync: true, syncedFrom: "peer-nas" },
    }]);
    expect(imported).toBe(1);

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const node = dash.nodes.find((n) => n.provider === "gwpeer");
    expect(node).toBeTruthy();
    expect(node.requests).toBe(1);
    // status "error" was passed through by importUsageRows → success rate reflects it.
    expect(node.successRate).toBeLessThan(100);

    const model = dash.models.find((m) => m.provider === "gwpeer" && m.model === "gwpeer-1");
    expect(model).toBeTruthy();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const localDayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const day = dash.daily.find((d) => d.date === localDayKey);
    expect(day).toBeTruthy();
  });

  it("chained client-ledger import (imported, no gatewaySync) stays excluded", async () => {
    // A row the SOURCE instance had itself imported from a client ledger
    // (zcode/mirasim/mimo) travels through --source 10r without the marker —
    // it must remain excluded from scores.
    const { imported } = await usageRepo.importUsageRows([{
      ...IMPORTED_ROW,
      provider: "chained",
      model: "chained-1",
      connectionId: null,
      timestamp: todayIso(),
      meta: { imported: true, source: "zcode", syncedFrom: "peer-nas" },
    }]);
    expect(imported).toBe(1);

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    expect(dash.nodes.find((n) => n.provider === "chained")).toBeUndefined();
    expect(dash.models.find((m) => m.provider === "chained")).toBeUndefined();
    // Still counted in the heatmap.
    expect(dash.lifetime.totalRequests).toBeGreaterThan(0);
  });

  it("sqlite backup import stamps gatewaySync on native rows only", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const srcPath = path.join(tempDir, "peer.sqlite");
    const src = new DatabaseSync(srcPath);
    src.exec(`CREATE TABLE usageHistory (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, provider TEXT, model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER, completionTokens INTEGER, cost REAL, status TEXT, tokens TEXT, meta TEXT)`);
    const ins = src.prepare(`INSERT INTO usageHistory (timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta) VALUES (?,?,?,?,?,?,?,?,?)`);
    const nativeTokens = JSON.stringify({ prompt_tokens: 10, completion_tokens: 5 });
    ins.run(todayIso(), "sqlnative", "sqlnative-1", 10, 5, 0, "error", nativeTokens, null);
    ins.run(todayIso(), "sqlimported", "sqlimported-1", 20, 6, 0, "ok", nativeTokens, JSON.stringify({ imported: true, source: "zcode" }));
    src.close();

    const { importUsageFromSqlite } = await import("@/app/api/settings/database/import-usage/importUsage.js");
    const buffer = fs.readFileSync(srcPath);
    const result = await importUsageFromSqlite(buffer, "peer.sqlite");
    expect(result.imported).toBe(2);

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const nativeRow = db.get(`SELECT meta FROM usageHistory WHERE provider = 'sqlnative'`);
    expect(JSON.parse(nativeRow.meta).gatewaySync).toBe(true);
    const importedRow = db.get(`SELECT meta FROM usageHistory WHERE provider = 'sqlimported'`);
    expect(JSON.parse(importedRow.meta).gatewaySync).toBeUndefined();

    const dash = await usageRepo.getUsageDashboard({ days: 3650, minRequests: 1 });
    expect(dash.nodes.find((n) => n.provider === "sqlnative")).toBeTruthy();
    expect(dash.nodes.find((n) => n.provider === "sqlimported")).toBeUndefined();
  });

  it("range params are ignored: nodes use a fixed 7d window, daily is unaffected", async () => {
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      provider: "oldco",
      model: "old-1",
      connectionId: "conn-old",
      timestamp: "2026-08-01T10:00:00.000Z",
    });

    const pad = (n) => String(n).padStart(2, "0");
    const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    const startKey = localKey(start);
    const endKey = localKey(end);

    const dash = await usageRepo.getUsageDashboard({ start: startKey, end: endKey, minRequests: 1 });
    // Node health is a fixed trailing-7d window regardless of range params:
    // the old row is outside 7d, today's acme row is inside.
    expect(dash.nodes.find((n) => n.provider === "oldco")).toBeUndefined();
    expect(dash.nodes.find((n) => n.provider === "acme")).toBeTruthy();
    // The heatmap series covers the trailing 12 months either way.
    expect(dash.daily.find((d) => d.date === "2026-08-01")).toBeTruthy();
  });

  it("default threshold excludes nodes/models under 100 requests from scoring", async () => {
    const dash = await usageRepo.getUsageDashboard({ days: 30 });
    // acme has exactly 1 live request — far below the default 100 threshold.
    expect(dash.nodes.find((n) => n.provider === "acme")).toBeUndefined();
    expect(dash.models.find((m) => m.provider === "acme")).toBeUndefined();
    // The daily series has no request threshold.
    expect(dash.daily.length).toBeGreaterThan(0);
  });

  it("cacheHitRate strictly excludes requests with no cache or prompt == cached", async () => {
    // 1. Request with no cache (cached = 0) -> should be excluded
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      tokens: { prompt_tokens: 500, completion_tokens: 50, cached_tokens: 0 },
    });
    // 2. Request with input = cache (prompt == cached) -> should be excluded
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      tokens: { prompt_tokens: 300, completion_tokens: 20, cached_tokens: 300 },
    });
    // 3. Request with valid real cache (prompt = 1000, cached = 750) -> should be counted (75.0%)
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      tokens: { prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 750 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    expect(dash.lifetime.cacheHitRate).toBe(75);
    expect(dash.lifetime.cacheTokens).toBe(750);
    expect(dash.lifetime.cacheRequests).toBe(1);
  });

  it("cacheHitRate counts raw Claude-shape rows (prompt cache-exclusive) via max(prompt, read+creation)", async () => {
    // The old `cached >= prompt` skip silently dropped exactly these rows:
    // raw translator usage stores prompt cache-EXCLUSIVE next to a large
    // cache_read (e.g. zcode-free: prompt_tokens=8, cache_read=263296) —
    // near-100% hits excluded from the rate. max(prompt, read+creation)
    // resolves both storage shapes without a shape flag.
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      tokens: { prompt_tokens: 8, completion_tokens: 5, cache_read_input_tokens: 263296 },
    });
    // Creation rides in the denominator as a miss; for the raw shape the
    // total is read + creation (prompt is exclusive), not the tiny prompt.
    await usageRepo.saveRequestUsage({
      ...LIVE_ROW,
      tokens: { prompt_tokens: 200, completion_tokens: 10, cache_read_input_tokens: 600, cache_creation_input_tokens: 200 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    // Prior valid row (750/1000) + these two: hit = 750+263296+600 = 264646;
    // total = 1000 + 263296 + 800 = 265096 → 99.8%.
    expect(dash.lifetime.cacheTokens).toBe(264646);
    expect(dash.lifetime.cacheRequests).toBe(3);
    expect(dash.lifetime.cacheCreationTokens).toBe(200);
    expect(dash.lifetime.cacheHitRate).toBe(99.8);
  });

  it("avgSpeed computes correctly for streaming and non-streaming requests", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const insertDetail = (id, latency, tokens) => {
      const record = { id, timestamp: todayIso(), provider: "speed-provider", model: "speed-model", latency, tokens };
      db.run(
        `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [id, record.timestamp, record.provider, record.model, null, "success", JSON.stringify(record)]
      );
    };

    // 1. Streaming request: ttft=200ms, total=1200ms (duration=1000ms), completion_tokens=50 -> 50 tok/s
    insertDetail("detail-stream", { ttft: 200, total: 1200 }, { prompt_tokens: 10, completion_tokens: 50 });
    // 2. Non-streaming request (or instant stream): ttft=1000ms, total=1000ms (duration=1000ms), completion_tokens=30 -> 30 tok/s
    insertDetail("detail-nonstream", { ttft: 1000, total: 1000 }, { prompt_tokens: 10, completion_tokens: 30 });

    // Add 1 request row in usageHistory so it passes minRequests
    await usageRepo.saveRequestUsage({
      timestamp: todayIso(),
      provider: "speed-provider",
      model: "speed-model",
      status: "ok",
      tokens: { prompt_tokens: 20, completion_tokens: 80 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const node = dash.nodes.find((n) => n.provider === "speed-provider");
    expect(node).toBeTruthy();
    // (50 tokens / 1s + 30 tokens / 1s) -> total 80 tokens / 2s = 40 tok/s
    expect(node.avgSpeed).toBe(40);
  });

  it("dampens burst-buffered requests (speed > 300 tok/s) by falling back to total latency and supports output_tokens", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const insertDetail = (id, latency, tokens) => {
      const record = { id, timestamp: todayIso(), provider: "burst-provider", model: "burst-model", latency, tokens };
      db.run(
        `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [id, record.timestamp, record.provider, record.model, null, "success", JSON.stringify(record)]
      );
    };

    // Burst stream: upstream buffered output so ttft=4900, total=5000 (total-ttft = 100ms), 500 output_tokens.
    // Instantaneous speed = 500 / 0.1 = 5000 tok/s (> 300).
    // Damped fallback uses total duration = 5000ms -> 500 / 5s = 100 tok/s.
    insertDetail("detail-burst", { ttft: 4900, total: 5000 }, { input_tokens: 10, output_tokens: 500 });

    await usageRepo.saveRequestUsage({
      timestamp: todayIso(),
      provider: "burst-provider",
      model: "burst-model",
      status: "ok",
      tokens: { prompt_tokens: 10, completion_tokens: 500 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const node = dash.nodes.find((n) => n.provider === "burst-provider");
    expect(node).toBeTruthy();
    expect(node.avgSpeed).toBe(100);
  });

  it("nodes with zero latency samples are excluded from health scoring entirely", async () => {
    // Regression: NAS-style nodes whose traffic exists only in usageHistory
    // (gateway-synced rows / rotated-out requestDetails ring) used to
    // redistribute the missing perf weight to successRate — 100% success
    // with NO measured latency/speed displayed as a full 100 health score.
    // Decision: missing perf data is not a neutral score, it is NO score —
    // the row keeps its traffic stats but does not participate in ranking.
    for (let i = 0; i < 6; i++) {
      await usageRepo.saveRequestUsage({
        ...LIVE_ROW,
        provider: "noperf",
        model: "noperf-1",
        connectionId: `np-${i}`,
      });
    }

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const node = dash.nodes.find((n) => n.provider === "noperf");
    expect(node).toBeTruthy();
    expect(node.successRate).toBe(100);
    expect(node.hasPerfData).toBe(false);
    expect(node.avgLatencyMs).toBeNull();
    expect(node.score).toBeNull();
  });

  it("computes speed from usageHistory meta latency (survives sync + ring rotation)", async () => {
    // The meta-carried latency path: rows written by executors since 1.1.2
    // carry meta.latencyMs/ttftMs, and gateway-synced rows keep them — so a
    // sibling instance sees real speed instead of a dash. No requestDetails
    // rows exist for this provider at all.
    await usageRepo.saveRequestUsage({
      timestamp: todayIso(),
      provider: "metaperf",
      model: "metaperf-1",
      status: "ok",
      tokens: { prompt_tokens: 100, completion_tokens: 200 },
      meta: { latencyMs: 2000, ttftMs: 500, gatewaySync: true, syncedFrom: "win-desktop" },
    });
    await usageRepo.saveRequestUsage({
      timestamp: todayIso(),
      provider: "metaperf",
      model: "metaperf-1",
      status: "ok",
      tokens: { prompt_tokens: 100, completion_tokens: 100 },
      meta: { latencyMs: 1000, ttftMs: 1000 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const model = dash.models.find((m) => m.provider === "metaperf");
    expect(model).toBeTruthy();
    expect(model.hasPerfData).toBe(true);
    expect(model.avgLatencyMs).toBe(1500);
    expect(model.avgTtftMs).toBe(750);
    // row1: 200tok / (2000-500)ms; row2: 100tok / 1000ms (ttft==total → total)
    // → 300 tokens / 2.5s = 120 tok/s
    expect(model.avgSpeed).toBe(120);
    expect(model.score).toBeGreaterThan(0);
    expect(model.score).not.toBeNull();
  });

  it("falls back to requestDetails for keys with no meta latency samples", async () => {
    // Pre-1.1.2 history: speed-provider has requestDetails rows only (set by
    // an earlier test) and no meta latency — the fallback must keep serving.
    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const node = dash.nodes.find((n) => n.provider === "speed-provider");
    expect(node).toBeTruthy();
    expect(node.avgSpeed).toBe(40);
  });

  it("per-metric merge: TTFT survives from requestDetails when meta rows lack it", async () => {
    // Observed on mimo-x-pro-preview: meta rows came from the non-streaming
    // branch (latencyMs only, no ttftMs) and the old meta-preference hid the
    // TTFT history kept in requestDetails. Both stores now feed one bucket
    // per metric; rows missing one metric never drag the others down.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const detail = {
      id: "pm-detail-1", timestamp: todayIso(), provider: "pmtest", model: "pmtest-1",
      latency: { ttft: 800, total: 3000 }, tokens: { prompt_tokens: 10, completion_tokens: 100 },
    };
    db.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [detail.id, detail.timestamp, detail.provider, detail.model, null, "success", JSON.stringify(detail)]
    );
    await usageRepo.saveRequestUsage({
      timestamp: todayIso(), provider: "pmtest", model: "pmtest-1", status: "ok",
      tokens: { prompt_tokens: 10, completion_tokens: 100 },
      meta: { latencyMs: 2000 },
    });

    const dash = await usageRepo.getUsageDashboard({ days: 30, minRequests: 1 });
    const model = dash.models.find((m) => m.provider === "pmtest");
    expect(model).toBeTruthy();
    expect(model.avgTtftMs).toBe(800);   // only the details row carries ttft
    expect(model.avgLatencyMs).toBe(2500); // (3000 + 2000) / 2
    // details: 100tok / 2.2s; meta: 100tok / 2.0s → 200 / 4.2s = 47.6
    expect(model.avgSpeed).toBe(47.6);
    expect(model.hasTtft).toBe(true);   // TTFT axis survived via requestDetails
    expect(model.hasSpeed).toBe(true);
  });

  it("defaults minRequests to 50 in getUsageDashboard", async () => {
    const dash = await usageRepo.getUsageDashboard();
    // Default call without arguments succeeds with minRequests = 50
    expect(dash).toHaveProperty("nodes");
    expect(dash).toHaveProperty("models");
  });
});
