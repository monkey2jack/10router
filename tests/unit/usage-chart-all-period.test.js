// getChartData("all"): every recorded day, oldest → newest, with the same
// tokens/cost/byModel bucket shape as the windowed branches.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let usageRepo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-chart-all-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
});

afterAll(() => {
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getChartData all-time period", () => {
  it("spans from the earliest recorded day to today in day buckets", async () => {
    const daysAgo = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      d.setHours(12, 0, 0, 0);
      return d.toISOString();
    };
    // One record 3 days back, one today — the chart must cover the whole span.
    await usageRepo.saveRequestUsage({
      timestamp: daysAgo(3), provider: "acme", model: "mimo-x-flash-preview", status: "ok",
      tokens: { prompt_tokens: 40, completion_tokens: 60 },
    });
    await usageRepo.saveRequestUsage({
      timestamp: daysAgo(0), provider: "acme", model: "glm-5.3-flash", status: "ok",
      tokens: { prompt_tokens: 10, completion_tokens: 15 },
    });

    const data = await usageRepo.getChartData("all");
    // earliest = today−3 → exactly 4 day buckets, no trailing empty "tomorrow".
    expect(data).toHaveLength(4);

    // Oldest bucket first, newest last.
    expect(data[0].tokens).toBe(100);
    expect(data[3].tokens).toBe(25);

    // Model distribution works over the unbounded range too.
    const byModel = data.reduce((acc, b) => {
      for (const [f, t] of Object.entries(b.byModel || {})) acc[f] = (acc[f] || 0) + t;
      return acc;
    }, {});
    expect(byModel.mimo).toBe(100);
    expect(byModel.glm).toBe(25);

    // Total conserved.
    const total = data.reduce((a, b) => a + b.tokens, 0);
    expect(total).toBe(125);
  });
});
