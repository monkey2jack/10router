// Issue #46, root fix: markAccountUnavailable wrote `testStatus: "unavailable"`
// alongside a PER-MODEL lock, so one model's 429 marked the whole connection as
// dead while every sibling model kept serving — selection only ever consulted
// modelLock_<model> (auth.js:185-194), so the routing was right and only the
// stored status was a lie.
//
// The flag is now written only for an account-wide lock (modelLock___all).
// These cases are the two assertions that would have caught the original bug:
//   1. a per-model failure must not mark the account unavailable
//   2. an account-wide failure still must
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const write = () => dbMocks.updateProviderConnection.mock.calls.at(-1)?.[1];
const lockKeys = () => Object.keys(write() || {}).filter((k) => k.startsWith("modelLock_"));

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue(undefined);
  dbMocks.getProviderConnections.mockResolvedValue([
    { id: "conn-a", provider: "antigravity", name: "ag-a", backoffLevel: 0 },
  ]);
});

const QUOTA_429 = '[429]: {"error":{"code":429,"message":"Individual quota reached. Resets in 1h27m36s.","status":"RESOURCE_EXHAUSTED","details":[{"metadata":{"model":"gemini-3.8-flash-high","quotaResetDelay":"1h27m36s"}}]}}';

describe("a per-model failure does not mark the account unavailable (#46)", () => {
  it("writes the per-model lock and leaves testStatus untouched", async () => {
    await markAccountUnavailable("conn-a", 429, QUOTA_429, "antigravity", "gemini-3.8-flash-high");

    // The lock exists, and it is scoped to the model that actually failed.
    expect(lockKeys()).toEqual(["modelLock_gemini-3.8-flash-high"]);
    // The lie is gone: the account is not declared dead.
    expect(write()).not.toHaveProperty("testStatus");
  });

  it("still records WHY the model is locked", async () => {
    await markAccountUnavailable("conn-a", 429, QUOTA_429, "antigravity", "gemini-3.8-flash-high");
    // The dashboard row renders these (translateQuotaError pulls the reset
    // clock and model out of lastError; extractAccountsVerificationUrl reads
    // it too). Dropping them would make a locked model silently locked.
    expect(write().lastError).toContain("Individual quota reached");
    expect(write().errorCode).toBe(429);
    expect(write().lastErrorAt).toBeTruthy();
  });

  it("does not touch siblings' state — a 401 on one model leaves others selectable", async () => {
    await markAccountUnavailable("conn-a", 401, "Unauthorized", "antigravity", "claude-sonnet-4-6");
    expect(lockKeys()).toEqual(["modelLock_claude-sonnet-4-6"]);
    expect(write()).not.toHaveProperty("testStatus");
  });

  it("backoffLevel is still advanced so the cooldown grows across repeats", async () => {
    await markAccountUnavailable("conn-a", 429, QUOTA_429, "antigravity", "gemini-3.8-flash-high");
    expect(write().backoffLevel).toBeGreaterThan(0);
  });
});

describe("an account-wide failure still marks the account unavailable", () => {
  it("writes both modelLock___all and testStatus when no model is given", async () => {
    await markAccountUnavailable("conn-a", 429, QUOTA_429, "antigravity", null);

    expect(lockKeys()).toEqual(["modelLock___all"]);
    expect(write().testStatus).toBe("unavailable");
  });

  it("treats a missing model the same as an explicit null", async () => {
    // Callers that only know the connection (older handler signatures) still
    // get the account-level behavior rather than silently degrading to
    // per-model and leaving the account marked forever.
    await markAccountUnavailable("conn-a", 401, "Unauthorized", "antigravity");
    expect(lockKeys()).toEqual(["modelLock___all"]);
    expect(write().testStatus).toBe("unavailable");
  });
});

describe("non-locking outcomes are unchanged", () => {
  // The channel-scope path (no lock, no flag, reason recorded) is covered in
  // codebuddy-channel-block.test.js against a real 11128 payload; not repeated
  // here. What matters for this change is the early return below.

  it("an error that should not fall back writes nothing at all", async () => {
    await markAccountUnavailable("noauth", 429, QUOTA_429, "antigravity", "gemini-3.8-flash-high");
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
