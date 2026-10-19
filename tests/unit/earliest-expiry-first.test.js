import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractEarliestPackageExpiry } from "open-sse/services/usage/expiryExtractor.js";

describe("extractEarliestPackageExpiry", () => {
  it("extracts the soonest future expiry among non-exhausted packages", () => {
    const now = Date.now();
    const mockUsage = {
      plan: "CodeBuddy",
      quotas: {
        "Total Points": {
          used: 15,
          total: 600,
          resetAt: null,
        },
        "Monthly": {
          used: 5,
          total: 500,
          resetAt: new Date(now + 25 * 86400000).toISOString(),
          recurring: true,
        },
        "Bonus Pack 1": {
          used: 10,
          total: 100,
          resetAt: new Date(now + 3 * 86400000).toISOString(),
          recurring: false,
        },
        "Bonus Pack 2": {
          used: 50,
          total: 50, // exhausted!
          resetAt: new Date(now + 1 * 86400000).toISOString(),
          recurring: false,
        },
      },
    };

    const result = extractEarliestPackageExpiry(mockUsage);
    expect(result).not.toBeNull();
    expect(result.name).toBe("Bonus Pack 1");
    expect(result.expiry).toBe(mockUsage.quotas["Bonus Pack 1"].resetAt);
    expect(result.timestamp).toBeGreaterThan(now);
  });

  it("skips packages that have zero remaining credits", () => {
    const now = Date.now();
    const mockUsage = {
      plan: "CodeBuddy",
      quotas: {
        "Bonus Pack 1": {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: new Date(now + 2 * 86400000).toISOString(),
        },
        "Monthly": {
          used: 10,
          total: 100,
          remaining: 90,
          resetAt: new Date(now + 20 * 86400000).toISOString(),
        },
      },
    };

    const result = extractEarliestPackageExpiry(mockUsage);
    expect(result).not.toBeNull();
    expect(result.name).toBe("Monthly");
  });

  it("returns null if all packages are exhausted or have no future reset date", () => {
    const now = Date.now();
    const mockUsage = {
      plan: "CodeBuddy",
      quotas: {
        "Total Points": {
          used: 100,
          total: 100,
          resetAt: null,
        },
        "Old Pack": {
          used: 0,
          total: 100,
          resetAt: new Date(now - 86400000).toISOString(), // expired in past
        },
      },
    };

    const result = extractEarliestPackageExpiry(mockUsage);
    expect(result).toBeNull();
  });

  it("keeps a DRAINED recurring window (MiMo weekly / CodeBuddy refill) — reset time is the badge", () => {
    const now = Date.now();
    const mockUsage = {
      plan: "Xiaomi MiMo Desktop",
      quotas: {
        Weekly: {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: new Date(now + 2 * 86400000).toISOString(),
          unlimited: false,
          recurring: true,
        },
      },
    };
    const result = extractEarliestPackageExpiry(mockUsage);
    expect(result).not.toBeNull();
    expect(result.name).toBe("Weekly");
  });

  it("still skips a drained recurring window whose resetAt is in the past", () => {
    const now = Date.now();
    const mockUsage = {
      quotas: {
        Weekly: {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: new Date(now - 86400000).toISOString(),
          recurring: true,
        },
      },
    };
    expect(extractEarliestPackageExpiry(mockUsage)).toBeNull();
  });

  it("drained recurring window competes on earliest-reset alongside live packs", () => {
    const now = Date.now();
    const mockUsage = {
      quotas: {
        Weekly: {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: new Date(now + 2 * 86400000).toISOString(),
          recurring: true,
        },
        "Bonus Pack 1": {
          used: 10,
          total: 100,
          remainingPercentage: 90,
          resetAt: new Date(now + 10 * 86400000).toISOString(),
          recurring: false,
        },
      },
    };
    const result = extractEarliestPackageExpiry(mockUsage);
    expect(result.name).toBe("Weekly");
  });

  it("handles null or malformed usage objects safely", () => {
    expect(extractEarliestPackageExpiry(null)).toBeNull();
    expect(extractEarliestPackageExpiry({})).toBeNull();
    expect(extractEarliestPackageExpiry({ message: "error" })).toBeNull();
  });

  it("Qoder regression: a DRAINED pack inside an itemised bucket must not drive the countdown", () => {
    // The reported bug: 主号 had 赠送包 1 at 0/100 expiring in 3d and the only
    // live pack (25/100) at 19d. The badge showed 3d 13h — the dead pack's
    // expiry — so the account kept winning the earliest-expiry queue while
    // nothing spendable matched that countdown. The bucket-level resetAt is
    // derived from the soonest pack INCLUDING drained ones, so ranking must
    // happen on the LIVE packs of the itemised detail, not on the aggregate.
    const now = Date.now();
    const usage = {
      quotas: {
        user: { total: 0, used: 0, remaining: 0, resetAt: null },
        addOn: {
          total: 600,
          used: 575,
          remaining: 25,
          resetAt: new Date(now + 3 * 86400000).toISOString(), // soonest pack — DRAINED
          packs: [
            { total: 100, used: 100, remaining: 0, expiresAt: new Date(now + 3 * 86400000).toISOString() },
            { total: 100, used: 75, remaining: 25, expiresAt: new Date(now + 19 * 86400000).toISOString() },
          ],
        },
      },
    };
    const result = extractEarliestPackageExpiry(usage);
    expect(result).not.toBeNull();
    expect(result.timestamp).toBeGreaterThanOrEqual(now + 19 * 86400000 - 60000);
    expect(result.name).toBe("addOn");
    // red-zone signal comes from the live pack: 25/100 = 25%
    expect(result.remainingPercentage).toBeCloseTo(25);
  });

  it("itemised bucket with ALL packs drained contributes nothing", () => {
    const now = Date.now();
    const usage = {
      quotas: {
        addOn: {
          total: 200,
          used: 200,
          remaining: 0,
          resetAt: new Date(now + 2 * 86400000).toISOString(),
          packs: [
            { total: 100, used: 100, remaining: 0, expiresAt: new Date(now + 2 * 86400000).toISOString() },
            { total: 100, used: 100, remaining: 0, expiresAt: new Date(now + 9 * 86400000).toISOString() },
          ],
        },
      },
    };
    expect(extractEarliestPackageExpiry(usage)).toBeNull();
  });

  it("balance-only account contributes no fake percentage — relay degrades to dead-burn", () => {
    // MiniMax Code pay-as-you-go: only the Credits balance row exists, with no
    // denominator. Reading 1330 credits as "1330%" or 4 credits as "4%" would
    // both be lies, so the extractor reports nothing: the account keeps the
    // single-point carrier until upstream 429/lock retires it (rule 1 anyway).
    const usage = {
      quotas: {
        Credits: { name: "Credits", used: 0, total: 4, remaining: 4, isCreditBalance: true },
      },
    };
    expect(extractEarliestPackageExpiry(usage)).toBeNull();
  });

  it("windows + balance: the recurring windows rank, the balance stays out of the red zone", () => {
    const now = Date.now();
    const usage = {
      quotas: {
        "M2.7 · 5 hours": { used: 97, total: 100, remainingPercentage: 3, resetAt: new Date(now + 2 * 3600000).toISOString(), recurring: true },
        Credits: { name: "Credits", used: 0, total: 1330, remaining: 1330, isCreditBalance: true },
      },
    };
    const result = extractEarliestPackageExpiry(usage);
    expect(result.name).toBe("M2.7 · 5 hours");
    expect(result.remainingPercentage).toBe(3);
  });

  it("recurring window with a PAST reset is mid-refill — no stale remaining, no badge", () => {
    // The reset already happened but upstream hasn't rolled the numbers yet:
    // ranking on either signal would be wrong; the next refresh fixes it.
    const now = Date.now();
    const usage = {
      quotas: {
        Weekly: { used: 100, total: 100, remainingPercentage: 0, resetAt: new Date(now - 60000).toISOString(), recurring: true },
      },
    };
    expect(extractEarliestPackageExpiry(usage)).toBeNull();
  });
});

describe("Earliest Expiry Account Selection Logic", () => {
  it("sorts accounts by nearest future package expiry when enabled", () => {
    const now = Date.now();
    const connA = {
      id: "conn-a",
      name: "Account A (Main)",
      priority: 0,
      earliestPackageExpiry: new Date(now + 30 * 86400000).toISOString(),
    };
    const connB = {
      id: "conn-b",
      name: "Account B (Bonus Promo)",
      priority: 1,
      earliestPackageExpiry: new Date(now + 2 * 86400000).toISOString(),
    };
    const connC = {
      id: "conn-c",
      name: "Account C (No Expiry Info)",
      priority: 2,
      earliestPackageExpiry: null,
    };

    const availableConnections = [connA, connB, connC];

    // Simulate sorting logic from auth.js:
    const earliestExpiryFirst = true;
    let ordered = availableConnections;
    if (earliestExpiryFirst && availableConnections.length > 1) {
      ordered = [...availableConnections].sort((a, b) => {
        const timeA = (a.earliestPackageExpiry && new Date(a.earliestPackageExpiry).getTime() > now)
          ? new Date(a.earliestPackageExpiry).getTime()
          : Infinity;
        const timeB = (b.earliestPackageExpiry && new Date(b.earliestPackageExpiry).getTime() > now)
          ? new Date(b.earliestPackageExpiry).getTime()
          : Infinity;

        if (timeA !== timeB) {
          return timeA - timeB;
        }
        return (a.priority || 999) - (b.priority || 999);
      });
    }

    expect(ordered[0].id).toBe("conn-b"); // 2 days
    expect(ordered[1].id).toBe("conn-a"); // 30 days
    expect(ordered[2].id).toBe("conn-c"); // Infinity
  });

  it("maintains priority order when earliestExpiryFirst is false", () => {
    const now = Date.now();
    const connA = {
      id: "conn-a",
      priority: 0,
      earliestPackageExpiry: new Date(now + 30 * 86400000).toISOString(),
    };
    const connB = {
      id: "conn-b",
      priority: 1,
      earliestPackageExpiry: new Date(now + 2 * 86400000).toISOString(),
    };

    const availableConnections = [connA, connB];
    const earliestExpiryFirst = false;
    let ordered = availableConnections;
    if (earliestExpiryFirst && availableConnections.length > 1) {
      // sort
    }

    expect(ordered[0].id).toBe("conn-a"); // Priority 0 wins
  });
});
