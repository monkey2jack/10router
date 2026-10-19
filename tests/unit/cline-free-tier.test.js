// Cline's free tier lives in the `cline-free/` namespace and is published only
// by the recommended-models feed (which this fork's resolver already surfaces).
// These tests pin the pricing half — a free model must never inherit the paid
// rate of its vendor-prefixed twin — and the resolver's cline-free passthrough.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FEED_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

const FEED_RESPONSE = {
  recommended: [{ id: "anthropic/claude-opus-5", name: "Claude Opus 5", description: "", tags: ["NEW"] }],
  free: [
    { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", description: "", tags: [] },
    { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek V4.1 Flash", description: "", tags: [] },
    { id: "cline-free/gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "", tags: [] },
    { id: "cline-free/mimo-v2.6-flash", name: "Mimo V2.6 Flash", description: "", tags: [] },
  ],
  clinePass: [{ id: "cline-pass/glm-5.3", name: "GLM-5.3", description: "", tags: [] }],
};

describe("cline-free namespace pricing", () => {
  it("bills cline-free/* at zero", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    expect(getPricingForModel("cline", "cline-free/deepseek-v4.1-flash")).toMatchObject({
      input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0,
    });
  });

  it("bills cline-free/* muse-spark at zero", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    expect(getPricingForModel("cline", "cline-free/muse-spark-1.3-contributor").input).toBe(0);
  });

  it("still bills the paid twin at its published rate", async () => {
    const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
    expect(getPricingForModel("cline", "deepseek/deepseek-v4.1-flash").input).toBe(0.14);
    // Muse 供应商移植（上游 28809807）补齐了 Meta 官方价目：vendor 前缀
    // 双生（meta/muse-spark-…）按去前缀命中同一官方 contributor 档价格，
    // 不再返回 null；cline-free/* 命名空间在查找链上更靠前，仍恒为 0。
    expect(getPricingForModel("cline", "meta/muse-spark-1.3-contributor")).toMatchObject({
      input: 0.1,
      output: 0.2,
    });
  });

  it("zero price survives cost calculation over a large usage", async () => {
    const { getPricingForModel, calculateCostFromTokens } = await import("../../open-sse/providers/pricing.js");
    const pricing = getPricingForModel("cline", "cline-free/deepseek-v4.1-flash");
    const cost = calculateCostFromTokens(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, reasoning_tokens: 500_000 },
      pricing,
    );
    expect(cost).toBe(0);
  });
});

describe("resolveClineModels — feed free[] passthrough", () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url) === FEED_URL) {
      return { ok: true, status: 200, json: async () => FEED_RESPONSE, text: async () => JSON.stringify(FEED_RESPONSE) };
    }
    throw new Error("unexpected fetch: " + url);
  });

  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("surfaces the cline-free/* ids the feed publishes", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clineModels.js");
    const result = await resolveClineModels({ accessToken: "test-token" }, { fetchFn: fetchMock });
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("cline-free/muse-spark-1.3-contributor");
    expect(ids).toContain("cline-free/deepseek-v4.1-flash");
    // the cline-pass subscription tier must not leak into the cline list
    expect(ids).not.toContain("cline-pass/glm-5.3");
  });
});
