// issue #38: remote agents (e.g. CreditDaddy's account sync) create provider
// connections / custom nodes with a dashboard virtual key. The exception used to
// sit inside the ALWAYS_PROTECTED branch, which never matches these paths, so
// every remote virtual-key write got the deny-by-default 401.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  isDashboardAuthConfigured: vi.fn(() => true),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateApiKey: mocks.validateApiKey }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
  isDashboardAuthConfigured: mocks.isDashboardAuthConfigured,
}));

const { proxy } = await import("../../src/dashboardGuard.js");

const VALID_KEY = "sk-valid-virtual-key";

// A remote (non-loopback) caller: no peer-token stamp from custom-server.js.
function remote(method, pathname, headers = {}) {
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://router.example.com${pathname}`).searchParams },
    headers: new Headers({ host: "router.example.com", ...headers }),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://router.example.com${pathname}`,
  };
}
const withKey = (key = VALID_KEY) => ({ authorization: `Bearer ${key}` });

describe("dashboard guard: virtual-key provider writes (issue #38)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TENROUTER_PEER_TOKEN = "peer-token-fixture";
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockImplementation(async (k) => k === VALID_KEY);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows remote POST /api/providers with a valid virtual key", async () => {
    expect(await proxy(remote("POST", "/api/providers", withKey()))).toBe(mocks.nextResponse);
  });

  it("allows remote POST /api/provider-nodes with a valid virtual key", async () => {
    expect(await proxy(remote("POST", "/api/provider-nodes", withKey()))).toBe(mocks.nextResponse);
  });

  it("accepts the key via x-api-key too", async () => {
    expect(await proxy(remote("POST", "/api/providers", { "x-api-key": VALID_KEY }))).toBe(mocks.nextResponse);
  });

  it("rejects an invalid virtual key", async () => {
    const res = await proxy(remote("POST", "/api/providers", withKey("sk-wrong")));
    expect(res.status).toBe(401);
  });

  it("rejects a POST without any credential", async () => {
    const res = await proxy(remote("POST", "/api/providers"));
    expect(res.status).toBe(401);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("keeps listing providers protected (GET with a valid key → 401)", async () => {
    expect((await proxy(remote("GET", "/api/providers", withKey()))).status).toBe(401);
    expect((await proxy(remote("GET", "/api/provider-nodes", withKey()))).status).toBe(401);
  });

  it("keeps [id] update/delete and sub-routes protected", async () => {
    for (const [method, path] of [
      ["PUT", "/api/providers/conn-1"],
      ["DELETE", "/api/providers/conn-1"],
      ["POST", "/api/providers/conn-1/test"],
      ["DELETE", "/api/provider-nodes/node-1"],
    ]) {
      expect((await proxy(remote(method, path, withKey()))).status, `${method} ${path}`).toBe(401);
    }
  });

  it("still honours dashboardLocalOnly (remote → 403 even with a valid key)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, dashboardLocalOnly: true });
    expect((await proxy(remote("POST", "/api/providers", withKey()))).status).toBe(403);
  });

  it("does not open other management writes to virtual keys", async () => {
    expect((await proxy(remote("POST", "/api/keys", withKey()))).status).toBe(401);
    expect((await proxy(remote("POST", "/api/combos", withKey()))).status).toBe(401);
    expect((await proxy(remote("POST", "/api/shutdown", withKey()))).status).toBe(401);
  });

  it("leaves the read-only quota overview working (regression guard)", async () => {
    expect(await proxy(remote("GET", "/api/usage/quotas", withKey()))).toBe(mocks.nextResponse);
  });
});
