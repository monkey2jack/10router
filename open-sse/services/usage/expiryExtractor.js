/**
 * Extract earliest-expiring available quota package from usage payload.
 *
 * Scans `usage.quotas` across all packages (and, for buckets that itemise a
 * `packs[]` breakdown, across their LIVE packs — see below), skips exhausted
 * one-shot packages (used >= total or remaining <= 0) and summary aggregates
 * ("Total Points"), and returns the soonest future expiry timestamp/ISO string.
 * Exhausted RECURRING windows (recurring:true) are kept — their next reset time
 * is the point of the badge even (especially) when the window is drained.
 *
 * @param {Object} usage
 * @returns {{ expiry: string, name: string, timestamp: number, remainingPercentage?: number } | null}
 */
export function extractEarliestPackageExpiry(usage) {
  if (!usage || typeof usage !== "object" || !usage.quotas) return null;

  const now = Date.now();
  let earliestTime = Infinity;
  let earliestName = null;
  let earliestIso = null;
  let minRemaining = Infinity;

  // One candidate package — a top-level quota bucket, or one itemised pack
  // inside a bucket. Updates the running "earliest live expiry" and the
  // "most-constrained live remaining" signals.
  const consider = (label, pkg) => {
    if (!pkg || typeof pkg !== "object") return;

    // Packs carry `expiresAt`, top-level buckets carry `resetAt` — accept both.
    const resetRaw = pkg.resetAt ?? pkg.expiresAt;
    const resetTime = resetRaw ? new Date(resetRaw).getTime() : NaN;
    const hasReset = Number.isFinite(resetTime);
    // Sentinel dates (year 9999) mean "permanent" — same as having no date.
    const isFuture = hasReset && resetTime > now && new Date(resetTime).getFullYear() <= 2099;

    // A RECURRING window (recurring:true, e.g. MiMo weekly / MiniMax Code M Plan /
    // Antigravity 5h+7d) resets instead of dying: when it's drained, the upcoming
    // reset time is exactly the information the badge exists to show.
    //
    // However, when a recurring pack is marked `giftPack: true` (e.g. CodeBuddy CN's
    // Monthly refill allowance alongside multiple bonus packs): it is an additive
    // quota package, NOT a rate limit. When its cycle balance is 100% drained
    // (used >= total or remaining <= 0), it must NOT hijack the earliest expiry
    // timestamp over unconsumed bonus packs! Doing so makes every account report
    // the identical month-end reset date and wedges multi-account earliest-expiry
    // dispatch.
    const isExhausted = () => {
      const used = Number(pkg.used ?? 0);
      const total = Number(pkg.total ?? 0);
      if (total > 0 && used >= total) return true;
      if (pkg.remaining !== undefined && Number(pkg.remaining) <= 0) return true;
      if (pkg.remainingPercentage !== undefined && Number(pkg.remainingPercentage) <= 0) return true;
      return false;
    };

    if (pkg.recurring !== true || pkg.giftPack === true) {
      if (isExhausted()) return;
    }
    // A row whose reset date exists but is NOT a live future time is spent
    // (one-shot expired) or mid-refill (recurring past its mark) — it has no
    // countable future at all, and its stale `remaining` must not feed the
    // relay red-zone either.
    if (hasReset && !isFuture) return;

    // Track the most-constrained live bucket for the relay red-zone: a single
    // bucket dropping below the threshold triggers the handoff, even if it is
    // not the earliest-resetting one (a 5h window can be near-empty while a 7d
    // reservoir still has days left — the 5h one is what throttles throughput).
    // Runs for date-less rows too: a permanent allowance (MiniMax Code's
    // Credits balance, an unitemized Qoder remainder) has no countdown but
    // still says how close this account is to spent.
    const remaining = liveRemainingPercentage(pkg);
    if (remaining !== null && remaining < minRemaining) {
      minRemaining = remaining;
    }

    if (!isFuture) return;
    if (resetTime < earliestTime) {
      earliestTime = resetTime;
      earliestName = label;
      earliestIso = resetRaw instanceof Date ? resetRaw.toISOString() : String(resetRaw);
    }
  };

  for (const [name, quota] of Object.entries(usage.quotas)) {
    if (!quota || typeof quota !== "object") continue;

    // Skip aggregate / summary rows that don't represent a real package
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes("total") ||
      lowerName.includes("aggregate") ||
      lowerName.includes("summary")
    ) {
      continue;
    }

    // A bucket that itemises its packs (Qoder's addOn) is only their sum: the
    // pack list is the authoritative detail ("detail replaces aggregate" — the
    // same rule the dashboard cards follow). Rank on the packs, never on the
    // bucket-level resetAt, which producers derive from the soonest pack
    // *including drained ones*. The per-pack `consider` call applies the same
    // live/exhausted rules, so a fully drained pack list contributes nothing.
    if (Array.isArray(quota.packs) && quota.packs.length > 0) {
      for (const pack of quota.packs) {
        consider(pack?.name ? `${name} · ${pack.name}` : name, pack);
      }
      continue;
    }

    consider(name, quota);
  }

  if (earliestTime < Infinity || Number.isFinite(minRemaining)) {
    return {
      expiry: earliestIso,
      name: earliestName,
      timestamp: earliestTime < Infinity ? earliestTime : null,
      ...(Number.isFinite(minRemaining) ? { remainingPercentage: minRemaining } : {}),
    };
  }

  return null;
}

/**
 * Remaining-percentage of a live bucket, from the fields the usage handlers
 * populate. Prefers an explicit remainingPercentage; derives from used/total
 * otherwise. Returns null when neither is available (caller treats it as
 * "unknown" and does not pre-emptively switch).
 */
function liveRemainingPercentage(quota) {
  // A stored-value balance (MiniMax Code's Credits) has no denominator:
  // used/total would always read 100% and lie about headroom, so it never
  // feeds the percentage red-zone. A zero balance is already filtered by the
  // liveness check above (remaining <= 0 ⇒ account drops out of the ring);
  // a positive one is "healthy until upstream says otherwise".
  if (quota.isCreditBalance === true) return null;
  if (typeof quota.remainingPercentage === "number" && Number.isFinite(quota.remainingPercentage)) {
    return quota.remainingPercentage;
  }
  const used = Number(quota.used ?? 0);
  const total = Number(quota.total ?? 0);
  if (total > 0) {
    return Math.max(0, (total - used) / total) * 100;
  }
  if (typeof quota.remaining === "number" && Number.isFinite(quota.remaining)) {
    return quota.remaining;
  }
  return null;
}
