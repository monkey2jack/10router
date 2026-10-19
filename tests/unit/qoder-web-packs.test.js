// Qoder per-resource-pack breakdown via the WEB console endpoint.
//
// The openapi quota endpoint only exposes an aggregate addOnQuota; the per-pack
// list with real expiry lives at {web}/api/v2/me/usages/big_model_credits and
// accepts ONLY the browser session cookie (device/job tokens get 401).
// CreditDaddy captures that cookie and ships it in providerSpecificData on
// account sync. getQoderUsage must prefer this exact breakdown over the
// campaign approximation, cross-check the owner, and fall back cleanly when the
// session is missing / dead / mismatched.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const proxyAwareFetch = vi.fn(async (url, opts = {}) => {
  calls.push({ url, headers: opts.headers || {} });
  if (url.includes("/api/v2/quota/usage")) {
    if (opts.headers?.Authorization === "Bearer dt-zeroed") {
      // The documented zeroing bug: openapi answers all-zero buckets while the
      // credits are still live on the web console.
      return { ok: true, status: 200, json: async () => ({
        userId: "u-1", userQuota: { total: 0, used: 0, remaining: 0, unit: "credits" },
        addOnQuota: { total: 0, used: 0, remaining: 0, unit: "credits" },
        totalUsagePercentage: 0, isQuotaExceeded: false, expiresAt: 253402214400000,
      }) };
    }
    return { ok: true, status: 200, json: async () => ({
      userId: "u-1", userQuota: { total: 0, used: 0, remaining: 0, unit: "credits" },
      addOnQuota: { total: 900, used: 876, remaining: 24, unit: "credits" },
      totalUsagePercentage: 0.98, isQuotaExceeded: false, expiresAt: 253402214400000,
    }) };
  }
  if (url.includes("/api/v2/me/usages/big_model_credits")) {
    if (opts.headers?.Cookie === "dead-session") return { ok: false, status: 401, json: async () => ({}) };
    if (opts.headers?.Cookie === "plan-session") return { ok: true, status: 200, json: async () => ({
      user_id: "u-1",
      plan_quota: { quota_detail: [
        { limit_value: 200, used_value: 50, remaining_value: 150, expires_at: 1792635167844, source: "PLAN" },
        { limit_value: 100, used_value: 100, remaining_value: 0, expires_at: 1790000000000, source: "PLAN" },
      ] },
      resource_package_quota: { quota_detail: [
        { limit_value: 800, used_value: 0, remaining_value: 800, expires_at: 1793000000000, source: "RESOURCE_PACKAGE_SOURCE_BONUS" },
      ] },
      dedicated_resource_package_quota: { quota_detail: [
        { limit_value: 50, used_value: 10, remaining_value: 40, expires_at: 1794000000000, source: "RESOURCE_PACKAGE_SOURCE_ORG" },
      ] },
    }) };
    return { ok: true, status: 200, json: async () => ({
      user_id: "u-1",
      resource_package_quota: { quota_detail: [
        { limit_value: 100, used_value: 76, remaining_value: 24, expires_at: 1792635167844, source: "RESOURCE_PACKAGE_SOURCE_BONUS" },
        { limit_value: 500, used_value: 500, remaining_value: 0, expires_at: 1790783939000, source: "RESOURCE_PACKAGE_SOURCE_BONUS" },
        { limit_value: 0, used_value: 0, remaining_value: 0, expires_at: 0, source: "PLAN" },
      ] },
    }) };
  }
  if (url.includes("/sash/api/v1/me/campaigns")) {
    return { ok: true, status: 200, json: async () => ({ campaigns: [
      { claimStatus: "CLAIMED", benefit: { kind: "CREDITS", amount: 100, validity: { mode: "RELATIVE_DAYS", days: 30 } }, startAt: 1790000000 },
    ] }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
});

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const load = async () => {
  const mod = await import("../../open-sse/services/usage/misc.js");
  return mod.getQoderUsage;
};

describe("getQoderUsage — web per-pack breakdown (CreditDaddy synced cookie)", () => {
  beforeEach(() => { calls.length = 0; proxyAwareFetch.mockClear(); });

  it("prefers the web packs over the campaign approximation when a session is present", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-token", null, "qoder-cn", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "session=abc", capturedAt: "2026-09-30T11:47:56.904Z", userId: "u-1" },
    });
    const packs = out.quotas.addOn.packs;
    // Real per-pack values (not the soonest-first campaign guess): the 500 pack
    // is fully used, the 100 pack has 24 left, the zero-total PLAN row is dropped.
    expect(packs.map((p) => p.total)).toEqual([500, 100]);
    expect(packs.find((p) => p.total === 100).remaining).toBe(24);
    expect(packs.find((p) => p.total === 100).used).toBe(76);
    expect(packs.every((p) => p.expiresAt)).toBe(true);
    // Exact breakdown → no synthetic "unitemized" remainder row.
    expect(packs.some((p) => p.unitemized)).toBe(false);
    // Fixture carries no plan_quota rows → the user bucket falls back to the
    // openapi aggregate (zeroed here), keeping the pre-web behavior intact.
    expect(out.quotas.user.total).toBe(0);
    // CN cookie goes to the CN web host, not openapi.
    const webCall = calls.find((c) => c.url.includes("big_model_credits"));
    expect(webCall.url).toBe("https://qoder.cn/api/v2/me/usages/big_model_credits");
    expect(webCall.headers.Cookie).toBe("session=abc");
    // Campaign endpoint must NOT be consulted when the web path succeeds.
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(false);
  });

  it("falls back to the campaign approximation without a session", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-token", null, "qoder", null);
    expect(calls.some((c) => c.url.includes("big_model_credits"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(true);
    expect(out.quotas.addOn.packs.length).toBeGreaterThan(0);
  });

  it("falls back when the synced session is dead (401)", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-token", null, "qoder", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "dead-session", userId: "u-1" },
    });
    // Web call failed → campaign path still produced packs; nothing throws.
    expect(calls.some((c) => c.url.includes("big_model_credits"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(true);
    expect(Array.isArray(out.quotas.addOn.packs)).toBe(true);
  });

  it("rejects a session whose web user_id does not match the connection owner", async () => {
    const getQoderUsage = await load();
    await getQoderUsage("dt-token", null, "qoder", {
      userId: "someone-else",
      creditDaddyWebSession: { cookie: "session=abc", userId: "someone-else" },
    });
    // The mock web response carries user_id u-1 → mismatch → packs ignored,
    // campaign fallback used instead. (Guard against a stale/misbound cookie
    // showing another account's resource packs.)
    expect(calls.some((c) => c.url.includes("big_model_credits"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(true);
  });

  it("surfaces plan and org buckets from the web detail when openapi zeroes them", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-token", null, "qoder-cn", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "plan-session", userId: "u-1" },
    });
    // Plan rows still sum into the user bucket (API contract), though the
    // dashboard no longer charts it as a separate "Plan Credits" row.
    expect(out.quotas.user).toMatchObject({ total: 300, used: 150, remaining: 150 });
    expect(out.quotas.user.resetAt).toBe(new Date(1790000000000).toISOString());
    // Org packages sum into the organization bucket.
    expect(out.quotas.organization).toMatchObject({ total: 50, used: 10, remaining: 40 });
    // Plan 行并入包序列按到期日混排（套餐内 Credits 本身也是一个资源包）：
    // 100(10-07) → 200(10-21) → 800(10-25)，plan 包保留 "Plan Credits" 名称。
    expect(out.quotas.addOn.packs.map((p) => p.total)).toEqual([100, 200, 800]);
    expect(out.quotas.addOn.packs[0].remaining).toBe(0);
    expect(out.quotas.addOn.packs.filter((p) => p.name === "Plan Credits").map((p) => p.total))
      .toEqual([100, 200]);
    // 聚合 = 包和（明细替代聚合）：1,100 total / 150 used / 950 remaining。
    expect(out.quotas.addOn).toMatchObject({ total: 1100, used: 150, remaining: 950 });
    expect(out.quotas.addOn.resetAt).toBe(new Date(1790000000000).toISOString());
    // Campaign endpoint NOT consulted — the web packs are present.
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(false);
  });

  it("sums live web packs into the addOn aggregate when openapi zeroes it", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-zeroed", null, "qoder", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "session=abc", userId: "u-1" },
    });
    // openapi addOnQuota is all-zero here; the packs (100 + 500) ARE the
    // resource-package bucket. Without the pack-sum fallback the dashboard
    // skips the "Resource Package" row as an empty bucket (账号 #131 症状).
    expect(out.quotas.addOn).toMatchObject({ total: 600, used: 576, remaining: 24 });
    expect(out.quotas.addOn.packs.map((p) => p.total)).toEqual([500, 100]);
    // Web packs present → campaigns untouched.
    expect(calls.some((c) => c.url.includes("/campaigns"))).toBe(false);
  });

  it("campaign packs also fill the addOn aggregate when openapi zeroes it", async () => {
    const getQoderUsage = await load();
    const out = await getQoderUsage("dt-zeroed", null, "qoder", null);
    // No session → campaigns path; the derived pack (100 credits, RELATIVE_DAYS)
    // must lift the zeroed aggregate so the row renders.
    expect(out.quotas.addOn.total).toBeGreaterThan(0);
    expect(out.quotas.addOn.total).toBe(
      out.quotas.addOn.packs.reduce((s, p) => s + p.total, 0),
    );
  });

  it("flags webSessionExpired when a synced session yields nothing usable (issue #44)", async () => {
    const getQoderUsage = await load();
    // Dead cookie (401): the plan bucket falls back to the openapi aggregate,
    // which zeroes out on exactly the accounts that need the web rows — the
    // caller must be able to tell the user why the plan row looks wrong.
    const dead = await getQoderUsage("dt-token", null, "qoder", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "dead-session", userId: "u-1" },
    });
    expect(dead.webSessionExpired).toBe(true);
    // Owner mismatch is the same silent-failure shape.
    const mismatch = await getQoderUsage("dt-token", null, "qoder", {
      userId: "someone-else",
      creditDaddyWebSession: { cookie: "session=abc", userId: "someone-else" },
    });
    expect(mismatch.webSessionExpired).toBe(true);
  });

  it("stays silent (no webSessionExpired) when no session exists or the session works", async () => {
    const getQoderUsage = await load();
    const noSession = await getQoderUsage("dt-token", null, "qoder", null);
    expect(noSession.webSessionExpired).toBeUndefined();
    const good = await getQoderUsage("dt-token", null, "qoder-cn", {
      userId: "u-1",
      creditDaddyWebSession: { cookie: "session=abc", userId: "u-1" },
    });
    expect(good.webSessionExpired).toBeUndefined();
    expect(good.quotas.addOn.packs.length).toBeGreaterThan(0);
  });
});
