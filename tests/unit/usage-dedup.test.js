// Regression: the legacy saveRequestUsage dedup matched on content only
// (timestamp+provider+model+connection+apiKey+token counts), so two distinct
// requests landing in the same millisecond with identical token counts were
// silently dropped — history row, daily aggregate and lifetime counter all
// lost one. Callers now stamp a per-attempt usageKey; dedup only fires on the
// same key, and keyless callers keep the legacy content-only behavior.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

// NOTE: timestamps are computed from "now" so the 24h stats window in
// getUsageStats("24h") always contains them. Hardcoded dates rot as the wall
// clock moves past them (the suite silently started failing two days after
// it was written).
const NOW_MS = Date.now();
const SAME_MS = new Date(NOW_MS).toISOString();
const SAME_MS_PLUS_1 = new Date(NOW_MS + 1000).toISOString();
const SAME_MS_PLUS_2 = new Date(NOW_MS + 2000).toISOString();
const baseEntry = {
  provider: "deepseek",
  model: "deepseek-v4",
  connectionId: "c-dedup",
  apiKey: "sk-dedup",
  endpoint: "/v1/chat/completions",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-usage-dedup-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch { /* OS temp reaper will collect it */ }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("saveRequestUsage dedup (usageKey contract)", () => {
  it("two distinct requests in the same millisecond with identical content are BOTH counted", async () => {
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS, usageKey: "k-1" });
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS, usageKey: "k-2" });

    const hist = await db.getUsageHistory({ provider: "deepseek" });
    expect(hist.length).toBe(2);
    const stats = await db.getUsageStats("24h");
    expect(stats.totalRequests).toBe(2);
  });

  it("the same usageKey written twice counts once (idempotency guard still works)", async () => {
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS_PLUS_1, usageKey: "k-dup" });
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS_PLUS_1, usageKey: "k-dup" });

    const hist = await db.getUsageHistory({ provider: "deepseek" });
    expect(hist.length).toBe(3); // 2 from the previous case + 1, not 4
  });

  it("keyless callers keep the legacy content-only dedup", async () => {
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS_PLUS_2 });
    await db.saveRequestUsage({ ...baseEntry, timestamp: SAME_MS_PLUS_2 });

    const hist = await db.getUsageHistory({ provider: "deepseek" });
    expect(hist.length).toBe(4); // +1, second keyless write deduped
  });
});
