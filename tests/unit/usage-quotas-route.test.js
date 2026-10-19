import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GET /api/usage/quotas — aggregated, read-only quota overview (CreditDaddy integration).

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  computeConnectionUsage: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.getProviderConnections }));
vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: { claude: { name: "Claude Code" }, glm: { name: "GLM" } },
  // kilocode is a real OAuth provider with no usage API — it must not be listed.
  USAGE_SUPPORTED_PROVIDERS: ["claude", "glm"],
  USAGE_APIKEY_PROVIDERS: ["glm"],
}));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  computeConnectionUsage: mocks.computeConnectionUsage,
}));

const CONNS = [
  { id: "c1", provider: "claude", authType: "oauth", name: "work", email: "a@x.com", isActive: true, accessToken: "SECRET-AT", refreshToken: "SECRET-RT" },
  { id: "c2", provider: "glm", authType: "apikey", name: "glm key", isActive: false, apiKey: "SECRET-KEY" },
  { id: "c3", provider: "openai", authType: "apikey", name: "no usage api", apiKey: "SECRET-2" },
  { id: "c4", provider: "kilocode", authType: "oauth", name: "oauth, no usage api", accessToken: "SECRET-3" },
];

const CLAUDE_OK = { status: 200, body: { plan: "Max", quotas: { "session (5h)": { used: 30, total: 100, resetAt: "2026-09-24T10:00:00Z" } } } };

async function load() {
  vi.resetModules();
  return import("../../src/app/api/usage/quotas/route.js");
}
const req = (q = "") => ({ url: `http://localhost/api/usage/quotas${q}` });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe("GET /api/usage/quotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue(CONNS);
    mocks.computeConnectionUsage.mockImplementation(async (c) => (c.id === "c1"
      ? CLAUDE_OK
      : { status: 401, body: { error: "Credential refresh failed: expired" } }));
  });
  afterEach(() => vi.useRealTimers());

  it("lists exactly the dashboard's usage-capable connections, normalized, without credentials", async () => {
    const { GET } = await load();
    const data = await (await GET(req())).json();
    // c3: apikey provider without a usage API; c4: OAuth but no usage API at all.
    // The disabled c2 stays — the dashboard lists and queries disabled accounts too.
    expect(data.connections.map((c) => c.id)).toEqual(["c1", "c2"]);
    const [claude, glm] = data.connections;
    expect(claude).toMatchObject({ provider: "claude", providerName: "Claude Code", name: "work", email: "a@x.com", plan: "Max", isActive: true, cached: false });
    expect(claude.quotas[0]).toMatchObject({ name: "session (5h)", used: 30, total: 100 });
    expect(glm).toMatchObject({ providerName: "GLM", isActive: false, error: "Credential refresh failed: expired", quotas: [] });
    expect(JSON.stringify(data)).not.toMatch(/SECRET/);
  });

  it("uses the same eligibility rule as the dashboard's Provider Limits list", async () => {
    const quotas = await load();
    const { isUsageEligible } = await import("../../src/shared/utils/usageEligibility.js");
    expect(CONNS.filter(isUsageEligible).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(quotas.isUsageEligible).toBeUndefined(); // no private copy left to drift
  });

  it("caches per connection; ?force=1 refreshes once the 30s floor has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { GET, __test__ } = await load();
    await GET(req());
    expect(mocks.computeConnectionUsage).toHaveBeenCalledTimes(2);
    const again = await (await GET(req())).json();
    expect(mocks.computeConnectionUsage).toHaveBeenCalledTimes(2);
    expect(again.connections.every((c) => c.cached)).toBe(true);

    vi.setSystemTime(Date.now() + __test__.FORCE_MIN_INTERVAL_MS + 1);
    await GET(req("?force=1"));
    expect(mocks.computeConnectionUsage).toHaveBeenCalledTimes(4);
    expect(mocks.computeConnectionUsage).toHaveBeenLastCalledWith(expect.anything(), { force: true });
  });

  it("?force=1 inside the 30s floor serves the cache — a key holder cannot hammer upstream", async () => {
    const { GET } = await load();
    await GET(req());
    for (let i = 0; i < 5; i++) await GET(req("?force=1"));
    expect(mocks.computeConnectionUsage).toHaveBeenCalledTimes(2);
    const data = await (await GET(req("?force=1"))).json();
    expect(data.connections.every((c) => c.cached)).toBe(true);
  });

  it("concurrent requests share one upstream call per connection", async () => {
    const gate = deferred();
    mocks.computeConnectionUsage.mockImplementation(async (c) => { await gate.promise; return c.id === "c1" ? CLAUDE_OK : { status: 200, body: {} }; });
    const { GET } = await load();
    const all = Promise.all([GET(req()), GET(req()), GET(req("?force=1"))]);
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve();
    const results = await Promise.all((await all).map((r) => r.json()));
    expect(mocks.computeConnectionUsage).toHaveBeenCalledTimes(2); // c1 + c2, once each
    for (const data of results) expect(data.connections.find((c) => c.id === "c1").plan).toBe("Max");
  });

  it("a call that outlives its caller's timeout still lands in the cache and blocks duplicates meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const gate = deferred();
    mocks.computeConnectionUsage.mockImplementation(async (c) => (c.id === "c1" ? (await gate.promise, CLAUDE_OK) : { status: 200, body: {} }));
    const { GET, __test__ } = await load();

    const first = GET(req());
    await vi.advanceTimersByTimeAsync(25_000);
    const timedOut = (await (await first).json()).connections.find((c) => c.id === "c1");
    expect(timedOut.error).toMatch(/timeout/);
    expect(__test__.inflight.has("c1")).toBe(true);

    const second = GET(req("?force=1"));   // still running → joins, no second upstream call
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.computeConnectionUsage.mock.calls.filter(([c]) => c.id === "c1")).toHaveLength(1);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect((await (await second).json()).connections.find((c) => c.id === "c1").plan).toBe("Max");
    expect(__test__.cache.get("c1").entry.plan).toBe("Max");
    expect(__test__.inflight.has("c1")).toBe(false);
  });

  it("a throwing connection becomes an error entry instead of failing the overview", async () => {
    mocks.computeConnectionUsage.mockRejectedValueOnce(new Error("boom"));
    const { GET } = await load();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.connections.find((c) => c.error === "boom")).toBeTruthy();
  });
});
