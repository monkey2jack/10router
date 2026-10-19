/**
 * Quota tracker browser persistence (stale-while-revalidate). The page paints
 * from these entries before any network call, so what they keep — and what
 * they must NOT keep — is pinned here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  compactQuotaEntry,
  connectionsCacheKey,
  createLimiter,
  isQuotaFresh,
  readConnectionsCache,
  readQuotaEntries,
  writeConnectionsCache,
  writeQuotaEntry,
  QUOTA_CACHE_MAX_AGE_MS,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/quotaPageCache.js";

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  return store;
}

describe("quota page cache", () => {
  beforeEach(() => installStorage());

  it("never persists proxy credentials from the connection list", () => {
    const key = connectionsCacheKey({ page: 1, pageSize: 20, accountFilter: "all", providerFilter: "all" });
    writeConnectionsCache(key, {
      connections: [{ id: "a", provider: "qoder", providerSpecificData: { connectionProxyUrl: "http://u:secret@h:1", region: "cn" } }],
      pagination: { page: 1 },
      totals: {},
      providerOptions: ["qoder"],
    });
    const back = readConnectionsCache(key);
    expect(back.connections[0].providerSpecificData).toEqual({ region: "cn" });
    expect(JSON.stringify(back)).not.toContain("secret");
  });

  it("a different filter/page is a cache miss", () => {
    const k1 = connectionsCacheKey({ page: 1, pageSize: 20, accountFilter: "all", providerFilter: "all" });
    const k2 = connectionsCacheKey({ page: 1, pageSize: 20, accountFilter: "all", providerFilter: "qoder" });
    writeConnectionsCache(k1, { connections: [] });
    expect(readConnectionsCache(k2)).toBeNull();
    expect(readConnectionsCache(k1)).not.toBeNull();
  });

  it("keeps only what the card renders from a quota entry", () => {
    expect(compactQuotaEntry({ quotas: [1], raw: { huge: "x".repeat(50) } })).toEqual({ quotas: [1] });
    // Codex reads raw.resetCredits — that one field survives.
    expect(compactQuotaEntry({ quotas: [], raw: { resetCredits: { availableCount: 2 }, other: 1 } }))
      .toEqual({ quotas: [], raw: { resetCredits: { availableCount: 2 } } });
  });

  it("round-trips entries by connection and expires old ones", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    writeQuotaEntry("old", { quotas: [] }, now - QUOTA_CACHE_MAX_AGE_MS - 1000);
    writeQuotaEntry("new", { quotas: [{ name: "Weekly" }] }, now);
    const got = readQuotaEntries([{ id: "old" }, { id: "new" }]);
    expect(Object.keys(got)).toEqual(["new"]);
    expect(got.new.quotas[0].name).toBe("Weekly");
  });

  it("freshness decides whether opening the page refetches", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(isQuotaFresh({ cachedAt: new Date(now - 10_000).toISOString() }, now)).toBe(true);
    expect(isQuotaFresh({ cachedAt: new Date(now - 120_000).toISOString() }, now)).toBe(false);
    expect(isQuotaFresh(undefined, now)).toBe(false);
  });

  it("limits concurrent fetches", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () => run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });
});
