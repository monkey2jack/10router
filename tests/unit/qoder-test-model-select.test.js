/**
 * Qoder / Qoder CN "逐个测试" per-model check (2026-09 user report).
 *
 * The one-by-one picker sends a model ALIAS (the live catalog key, e.g.
 * "qmodel_38max"), and the test validates it against the account's own catalog —
 * a COSY-signed GET, no inference, no credits. Before this, qoder-cn answered
 * "Provider test not supported" and the picked model never mattered, while qoder
 * only ever ran a token-only userinfo probe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const connections = new Map();
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: async (id) => connections.get(id) || null,
  updateProviderConnection: async () => {},
}));

// The real catalog is a COSY-signed network fetch — control it here.
const catalogMock = vi.hoisted(() => ({ result: null, calls: [] }));
vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: async (conn, opts) => {
    catalogMock.calls.push({ provider: conn.provider, opts });
    return catalogMock.result;
  },
  resolveQoderCredentials: async (c) => c,
}));

// Keep the post-test background expiry refresh off the network.
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: async () => ({}),
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

function makeConn(id, provider) {
  const c = {
    id,
    provider,
    authType: "oauth",
    accessToken: "device-token",
    providerSpecificData: { userId: "u-1" },
    displayName: "acct",
  };
  connections.set(id, c);
  return c;
}

beforeEach(() => {
  connections.clear();
  catalogMock.result = null;
  catalogMock.calls = [];
  vi.unstubAllGlobals();
});

describe("qoder per-model connection test", () => {
  it("passes when the selected alias is in the account catalog", async () => {
    makeConn("q1", "qoder-cn");
    catalogMock.result = { models: [{ id: "qmodel_38max" }, { id: "gmodel" }] };
    const r = await testSingleConnection("q1", { model: "qmodel_38max" });
    expect(r.valid).toBe(true);
    // A Test button reflects the account NOW — the catalog is force-refreshed,
    // not read from the 1h chat cache.
    expect(catalogMock.calls[0].opts.forceRefresh).toBe(true);
  });

  it("fails, naming the ALIAS, when the model is absent from the catalog", async () => {
    makeConn("q1", "qoder-cn");
    catalogMock.result = { models: [{ id: "gmodel" }] };
    const r = await testSingleConnection("q1", { model: "qmodel_38max" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("qmodel_38max");
  });

  it("no longer answers 'Provider test not supported' for qoder-cn", async () => {
    makeConn("q1", "qoder-cn");
    catalogMock.result = { models: [{ id: "gmodel" }] };
    const r = await testSingleConnection("q1"); // no model → token check
    expect(r.valid).toBe(true);
    expect(r.error).not.toBe("Provider test not supported");
  });

  it("treats the aggregator id 'auto' as available when the catalog is non-empty", async () => {
    makeConn("q1", "qoder");
    catalogMock.result = { models: [{ id: "qmodel_38max" }] }; // 'auto' is not a catalog key
    const r = await testSingleConnection("q1", { model: "auto" });
    expect(r.valid).toBe(true);
  });

  it("falls back to a userinfo probe (valid) when the catalog is unreachable", async () => {
    makeConn("q1", "qoder");
    catalogMock.result = null; // catalog fetch failed
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await testSingleConnection("q1", { model: "qmodel_38max" });
    expect(r.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalled(); // the userinfo endpoint was hit
  });

  it("fails when the catalog is unreachable AND the token is revoked", async () => {
    makeConn("q1", "qoder");
    catalogMock.result = null;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
    const r = await testSingleConnection("q1");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid or expired/i);
  });
});
