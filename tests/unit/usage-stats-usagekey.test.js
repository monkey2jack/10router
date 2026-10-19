// saveUsageStats must FORWARD the usageKey (and latency) to saveRequestUsage.
// All chatCore call sites stamp one randomUUID per upstream attempt — the
// function previously dropped the parameter, so the dedup key contract was
// dead on the main chat path and two same-millisecond requests with identical
// token counts collapsed into one row. Regression guard for both the key
// forwarding and the latency observation riding on meta.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let saveUsageStats;
let getAdapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-usagekey-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ saveUsageStats } = await import("open-sse/handlers/chatCore/requestDetail.js"));
  ({ getAdapter } = await import("@/lib/db/driver.js"));
});

afterAll(() => {
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function waitForRows(provider, n, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT tokens, meta FROM usageHistory WHERE provider = ? ORDER BY id ASC`,
      [provider]
    );
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

describe("saveUsageStats key/latency forwarding", () => {
  it("distinct usageKeys survive same-millisecond dedup; latency rides on meta", async () => {
    const shared = {
      provider: "usagekeytest",
      model: "usagekeytest-1",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      latency: { ttft: 300, total: 1000 },
      silent: true,
    };
    // Fired back-to-back: same millisecond + identical content. Only the
    // distinct usageKeys tell the two attempts apart.
    saveUsageStats({ ...shared, usageKey: "attempt-A" });
    saveUsageStats({ ...shared, usageKey: "attempt-B" });

    const rows = await waitForRows("usagekeytest", 2);
    expect(rows.length).toBe(2);
    const keys = rows.map((r) => JSON.parse(r.meta || "{}").usageKey).sort();
    expect(keys).toEqual(["attempt-A", "attempt-B"]);
    for (const r of rows) {
      const meta = JSON.parse(r.meta || "{}");
      expect(meta.latencyMs).toBe(1000);
      expect(meta.ttftMs).toBe(300);
    }
  });
});
