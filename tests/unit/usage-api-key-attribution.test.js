// Usage stats API-key attribution: buckets group by the per-key sha256 digest
// (never the mask), and the display mask keeps the key's tail so team keys that
// share a machine-id prefix stay distinguishable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maskApiKey } from "@/lib/db/crypto/apiKeyIdentity.js";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-api-key-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  vi.resetModules();
});

describe("maskApiKey", () => {
  it("keeps the tail so same-prefix keys display distinctly", () => {
    const a = maskApiKey("sk-machine-aaaaaa-11111111");
    const b = maskApiKey("sk-machine-bbbbbb-22222222");
    expect(a).not.toBe(b);
    expect(a.startsWith("sk-machi***")).toBe(true);
    expect(a.endsWith("1111")).toBe(true);
  });

  it("falls back to the head-only form for short keys", () => {
    expect(maskApiKey("shortkey1")).toBe("s***");
    expect(maskApiKey(null)).toBeNull();
  });
});

describe("Usage stats API key attribution", () => {
  it("keeps API keys with the same masked prefix in separate buckets", async () => {
    const apiKeyA = "sk-machine-aaaaaa-11111111";
    const apiKeyB = "sk-machine-bbbbbb-22222222";

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyA,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyB,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    const apiKeyEntries = Object.values(stats.byApiKey);

    expect(apiKeyEntries).toHaveLength(2);

    expect(
      apiKeyEntries
        .map((entry) => entry.promptTokens)
        .sort((a, b) => a - b),
    ).toEqual([10, 20]);

    // And the display masks stay distinguishable.
    const masks = new Set(apiKeyEntries.map((entry) => entry.apiKeyMasked));
    expect(masks.size).toBe(2);
  });
});
