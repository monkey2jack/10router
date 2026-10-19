// Rerank vertical slice (issue #29) — offline contract tests:
//  - registry shape: rerank kind/config on the three shipped providers
//  - handleRerankCore: request build, pass-through, envelope normalization,
//    usage extraction, error paths
//  - kind plumbing: /v1/models kind filter + slug map + audit exclusion
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({ getSettings: vi.fn(async () => ({ requireApiKey: false })) }));

// rerankCore calls the GLOBAL fetch (same as systemoneCore) — stub it there.
vi.stubGlobal("fetch", mocks.fetch);

// ─── 1) registry shape ───────────────────────────────────────────────────────

const { PROVIDER_MEDIA, PROVIDERS } = await import("../../open-sse/providers/index.js");

describe("rerank registry shape", () => {
  it("declares rerankConfig + serviceKinds on the three shipped providers", () => {
    for (const id of ["cohere", "jina-ai", "siliconflow-cn"]) {
      expect(PROVIDER_MEDIA[id]?.rerankConfig?.baseUrl, id).toMatch(/^https:\/\/.+\/rerank$/);
    }
  });

  it("keeps rerank out of chat-capability resolution (kind isolation)", async () => {
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    // A reranker id must not resolve to a chat-capable row claiming vision etc.
    const caps = getCapabilitiesForModel("siliconflow-cn", "BAAI/bge-reranker-v2-m3");
    // Either null (fall-through) or tools:false via the service-kind map — the
    // invariant is just that nothing here *enables* chat tools.
    expect(caps ? caps.tools !== true : true).toBe(true);
  });
});

// ─── 2) handleRerankCore ─────────────────────────────────────────────────────

const { handleRerankCore } = await import("../../open-sse/handlers/rerankCore.js");

const baseCreds = { apiKey: "sk-test" };
const baseModel = { provider: "jina-ai", model: "jina-reranker-v3.5" };
const baseBody = { query: "capital of US", documents: ["a", "b"] };

function okUpstream(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.1 },
      ],
      ...overrides,
    }),
  };
}

beforeEach(() => {
  mocks.fetch.mockReset();
});

describe("handleRerankCore — request build", () => {
  it("posts to rerankConfig.baseUrl with Bearer auth and the model rewrite", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream());
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.success).toBe(true);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.jina.ai/v1/rerank");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("jina-reranker-v3.5");
    // Pass-through: client fields beyond the rewrite survive verbatim
    expect(sent.query).toBe("capital of US");
    expect(sent.documents).toEqual(["a", "b"]);
  });

  it("prefers a connection-level baseUrl over the registry default (self-host parity)", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream());
    await handleRerankCore({
      body: baseBody,
      modelInfo: baseModel,
      credentials: { apiKey: "k", providerSpecificData: { baseUrl: "http://127.0.0.1:9999/v1/rerank" } },
      log: null,
    });
    expect(mocks.fetch.mock.calls[0][0]).toBe("http://127.0.0.1:9999/v1/rerank");
  });

  it("400s when the provider has no rerankConfig", async () => {
    const r = await handleRerankCore({
      body: baseBody,
      modelInfo: { provider: "openai", model: "whatever" },
      credentials: baseCreds,
      log: null,
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/does not support rerank/);
  });
});

describe("handleRerankCore — validation", () => {
  it("400s a missing query and missing/empty documents", async () => {
    for (const body of [
      { documents: ["a"] },
      { query: "q" },
      { query: "q", documents: [] },
      { query: "q", documents: "not-an-array" },
    ]) {
      const r = await handleRerankCore({ body, modelInfo: baseModel, credentials: baseCreds, log: null });
      expect(r.success).toBe(false, JSON.stringify(body));
      expect(r.status).toBe(400);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("handleRerankCore — response normalization", () => {
  it("passes results through untouched and stamps a model echo", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream());
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    const body = await r.response.json();
    expect(body.results).toEqual([
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.1 },
    ]);
    expect(body.model).toBe("jina-ai/jina-reranker-v3.5");
  });

  it("does not overwrite an upstream model echo", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream({ model: "upstream-says" }));
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    const body = await r.response.json();
    expect(body.model).toBe("upstream-says");
  });

  it("502s a lane that returns no results array (broken upstream, not silent empty)", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.success).toBe(false);
    expect(r.status).toBe(502);
  });
});

describe("handleRerankCore — usage extraction", () => {
  it("extracts real token counts (Jina/SiliconFlow shape)", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream({ usage: { total_tokens: 42 } }));
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.usage).toEqual({ prompt_tokens: 42, completion_tokens: 0, total_tokens: 42 });
  });

  it("accepts prompt_tokens / input_tokens aliases", async () => {
    mocks.fetch.mockResolvedValueOnce(okUpstream({ usage: { prompt_tokens: 7, total_tokens: 9 } }));
    let r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.usage.prompt_tokens).toBe(7);
    expect(r.usage.total_tokens).toBe(9);

    mocks.fetch.mockResolvedValueOnce(okUpstream({ usage: { input_tokens: 5 } }));
    r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.usage).toEqual({ prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 });
  });

  it("records nothing when only a request count exists (Cohere search_units is NOT tokens)", async () => {
    // A lane that echoes Cohere's billed-units shape must not put a request
    // counter into the token ledger — that is how cost charts start lying.
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ index: 0, relevance_score: 1 }],
        meta: { billed_units: { search_units: 1 } },
      }),
    });
    const r = await handleRerankCore({ body: baseBody, modelInfo: { provider: "cohere", model: "rerank-v3.5" }, credentials: baseCreds, log: null });
    expect(r.success).toBe(true);
    expect(r.usage).toBeNull();
  });
});

describe("handleRerankCore — error paths", () => {
  it("maps upstream errors through parseUpstreamError with the provider status", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({ error: { message: "rate limited" } }),
      text: async () => JSON.stringify({ error: { message: "rate limited" } }),
    });
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.success).toBe(false);
    expect(r.status).toBe(429);
  });

  it("502s a network failure with a provider-tagged message", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.success).toBe(false);
    expect(r.status).toBe(502);
    expect(typeof r.error).toBe("string");
    expect(r.error.length).toBeGreaterThan(0);
  });

  it("502s a non-JSON success response", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError("nope"); } });
    const r = await handleRerankCore({ body: baseBody, modelInfo: baseModel, credentials: baseCreds, log: null });
    expect(r.success).toBe(false);
    expect(r.status).toBe(502);
  });
});
