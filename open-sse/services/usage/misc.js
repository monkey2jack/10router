/**
 * Misc usage handlers (iFlow, Ollama, GLM, Vercel AI Gateway, Qoder)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";
import {
  QODER_OPENAPI_BASE,
  QODER_CN_OPENAPI_BASE,
  QODER_WEB_BASE,
  QODER_CN_WEB_BASE,
} from "../../shared/qoder/constants.js";

// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

const OLLAMA_LIMIT_WINDOWS = {
  session: "Session (5h)",
  weekly: "Weekly (7d)",
  monthly: "Monthly",
};

function addUtcMonths(date, months) {
  const total = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year, month, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
  ));
}

// Free plan: "usage resets monthly from the date you signed up" (ollama.com/pricing).
function nextMonthlyResetFromSignup(createdAt, now = new Date()) {
  const anchor = new Date(createdAt);
  if (Number.isNaN(anchor.getTime())) return null;
  const elapsedMonths = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12
    + (now.getUTCMonth() - anchor.getUTCMonth());
  for (let i = Math.max(0, elapsedMonths); i <= elapsedMonths + 1; i++) {
    const candidate = addUtcMonths(anchor, i);
    if (candidate > now) return candidate.toISOString();
  }
  return null;
}

/**
 * Ollama Cloud Usage
 * GET https://ollama.com/api/usage — `limits.<window>.usage` is a 0..1 ratio
 *   (1.0 = limit reached). Paid plans report session (5h) + weekly (7d); the
 *   free plan reports a single monthly window. No reset timestamp exposed;
 *   the free monthly reset is derived from the account's signup date.
 * POST https://ollama.com/api/me — plan label + CreatedAt (fail-open).
 * Auth: Authorization: Bearer <apiKey>
 */
export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama Cloud API key not available." };
  }

  try {
    const response = await proxyAwareFetch("https://ollama.com/api/usage", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }

    if (!response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    // Best-effort plan label from /api/me
    const me = await proxyAwareFetch("https://ollama.com/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }, proxyOptions).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    const planRaw = typeof me?.Plan === "string" ? me.Plan : "";
    const plan = planRaw
      ? planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase()
      : "Ollama Cloud";

    const limits = data?.limits && typeof data.limits === "object" ? data.limits : {};

    // Ollama `usage` is a 0..1 ratio (1.0 = limit reached). Convert to a 0..100
    // bar. Do NOT set absolute `remaining` — QuotaTable reads remainingPercentage.
    function ratioQuota(usageRatio, resetAt = null) {
      const ratio = Math.max(0, Math.min(1, Number(usageRatio) || 0));
      const usedPct = Math.round(ratio * 100);
      return { used: usedPct, total: 100, remainingPercentage: 100 - usedPct, resetAt, unlimited: false };
    }

    const monthlyResetAt = planRaw.toLowerCase() === "free" && me?.CreatedAt
      ? nextMonthlyResetFromSignup(me.CreatedAt)
      : null;

    const quotas = {};
    for (const [key, label] of Object.entries(OLLAMA_LIMIT_WINDOWS)) {
      const raw = limits[key]?.usage;
      if (raw === undefined || raw === null) continue;
      const ratio = Number(raw);
      if (Number.isNaN(ratio)) continue;
      quotas[label] = ratioQuota(ratio, key === "monthly" ? monthlyResetAt : null);
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan,
        message: "Ollama Cloud connected. No usage limits reported.",
        quotas: {},
      };
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}

/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */
export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    // Vercel returns numeric strings; coerce safely.
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    // Vercel gives $5/month free credit. The API doesn't return the
    // monthly allocation so we use the known constant as the denominator.
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    // "Used (USD)": how much has been spent this month (no fixed cap → unlimited).
    // "Remaining (USD)": balance remaining out of the $5 monthly allocation.
    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

/**
 * Build Qoder's per-pack breakdown from the campaigns list, reconciled against
 * the authoritative `addOnQuota` aggregate.
 *
 * The device-token campaigns list is the ONLY source of per-pack data, and it is
 * incomplete: a pack granted outside a campaign, or a campaign the listing has
 * since dropped, is simply absent. Observed live on a real account — aggregate
 * `total: 700` but only 500 + 100 across the listed packs, with the third gifted
 * pack (100 credits) present on the official account page and in no device-token
 * response. The aggregate is the source of truth, so when the listed packs cover
 * less than `total` we account for the remainder with one expiry-less pack;
 * otherwise the per-pack rows silently add up to less than the "Resource
 * Package" row directly above them, which reads as missing credits.
 *
 * @param {{campaigns?: Array, used?: number, total?: number, now?: number}} args
 * @returns {{packs: Array, resetAt: string|null}}
 */
export function buildQoderAddOnPacks({ campaigns = [], used = 0, total = 0, now = Date.now() } = {}) {
  const claimed = campaigns.filter(
    (c) => c?.claimStatus === "CLAIMED" && c?.benefit?.kind === "CREDITS",
  );
  const packs = [];
  for (const c of claimed) {
    const v = c.benefit?.validity;
    let expiresAtMs = null;
    if (v?.mode === "FIXED_END" && v.fixedEnd) {
      expiresAtMs = new Date(v.fixedEnd).getTime();
    } else if (v?.mode === "RELATIVE_DAYS" && v.days && c.startAt) {
      expiresAtMs = c.startAt * 1000 + v.days * 86400000;
    }
    const packTotal = Number(c.benefit?.amount) || 0;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now || packTotal <= 0) {
      continue;
    }
    packs.push({ total: packTotal, expiresAt: new Date(expiresAtMs).toISOString() });
  }
  packs.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

  // Qoder spends soonest-expiring credits first; the API only reports aggregate
  // used, so derive per-pack used with that assumption.
  let usedLeft = Math.max(0, Number(used) || 0);
  for (const p of packs) {
    const packUsed = Math.min(usedLeft, p.total);
    p.used = packUsed;
    p.remaining = p.total - packUsed;
    usedLeft -= packUsed;
  }

  // Reconcile with the aggregate. Appended LAST on purpose: an unknown expiry can
  // only be "not sooner" than every known one, so it must not pre-empt the known
  // packs in the soonest-first spend order above.
  const itemized = packs.reduce((sum, p) => sum + p.total, 0);
  const unattributed = (Number(total) || 0) - itemized;
  if (packs.length > 0 && unattributed > 0) {
    const packUsed = Math.min(usedLeft, unattributed);
    packs.push({
      total: unattributed,
      expiresAt: null,
      used: packUsed,
      remaining: unattributed - packUsed,
      unitemized: true,
    });
  }

  return { packs, resetAt: packs.length > 0 ? packs[0].expiresAt || null : null };
}

/**
 * Credit detail from the Qoder WEB console
 * (GET {web}/api/v2/me/usages/big_model_credits).
 *
 * The openapi quota endpoint only exposes the aggregate buckets (userQuota /
 * addOnQuota), and for some accounts those come back zeroed while credits are
 * still live. The web console is the authoritative per-row source — plan
 * credits (plan_quota), gifted/purchased resource packs (resource_package_quota)
 * and org packages (dedicated_resource_package_quota) each carry real per-row
 * expiry — and it accepts ONLY the browser's httpOnly session cookie
 * (device/job tokens get 401). CreditDaddy captures that cookie in its login
 * window and ships it to 10Router inside
 * providerSpecificData.creditDaddyWebSession on account sync.
 *
 * Returns { packs, planRows, orgRows, resetAt, sourceUserId } or null (no
 * cookie / call failed / response shape changed) so callers fall back to the
 * aggregate-only view.
 */
export async function fetchQoderWebPacks(cookie, providerId = "qoder", proxyOptions = null) {
  if (!cookie || typeof cookie !== "string") return null;
  try {
    const webBase = providerId === "qoder-cn" ? QODER_CN_WEB_BASE : QODER_WEB_BASE;
    const res = await proxyAwareFetch(
      `${webBase}/api/v2/me/usages/big_model_credits`,
      {
        method: "GET",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          Referer: `${webBase}/account/usage`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
      proxyOptions,
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || !body.user_id) return null;
    const readSection = (key) => {
      const rows = body?.[key]?.quota_detail;
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r) => ({
          total: Number(r?.limit_value) || 0,
          used: Number(r?.used_value) || 0,
          remaining: Number(r?.remaining_value) || 0,
          expiresAt: Number(r?.expires_at) > 0 ? new Date(Number(r.expires_at)).toISOString() : null,
          source: r?.source || null,
        }))
        .filter((p) => p.total > 0)
        .sort((a, b) => (a.expiresAt || "9999").localeCompare(b.expiresAt || "9999"));
    };
    const packs = readSection("resource_package_quota");
    const planRows = readSection("plan_quota");
    const orgRows = readSection("dedicated_resource_package_quota");
    if (!packs.length && !planRows.length && !orgRows.length) return null;
    return {
      packs,
      planRows,
      orgRows,
      resetAt: packs[0]?.expiresAt || null,
      sourceUserId: body.user_id,
    };
  } catch {
    return null;
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null, providerId = "qoder", providerSpecificData = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const usageUrl = U(providerId).url || U("qoder").url;
    const response = await proxyAwareFetch(
      usageUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const addOnQuota = body.addOnQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total. Sentinel values (e.g. year 9999 /
    // 253402214400000) mean "no expiration / permanent" — ignore them so
    // we don't render a 2.9-million-day countdown.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const isSentinelExpiry = expiresAtMs && (expiresAtMs >= 253400000000000 || new Date(expiresAtMs).getFullYear() > 2099);
    const resetAt = expiresAtMs && !isSentinelExpiry ? new Date(expiresAtMs).toISOString() : null;
    // Fetch active campaigns to resolve the resource-package breakdown.
    // Qoder's device-token API only exposes the aggregated `addOnQuota`;
    // the web UI's per-pack list (`/api/v2/me/usages/big_model_credits`)
    // is cookie-auth only. Each CLAIMED campaign with a CREDITS benefit is
    // one gifted pack: `benefit.amount` credits, expiring at `FIXED_END`
    // or `startAt + RELATIVE_DAYS` (claim day is not exposed, so campaign
    // start is the best available proxy). Best-effort: on any failure we
    // fall back to the aggregate-only view.
    let addOnResetAt = null;
    let addOnPacks = [];
    // The web rows also carry the plan (套餐内) and org-package buckets, which
    // the openapi endpoint zeroes out on some accounts — sum them into the
    // user / organization quota records so the dashboard's plan row survives.
    let webPlan = null;
    let webOrg = null;
    const sumWebRows = (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      return {
        total: sum("total"),
        used: sum("used"),
        remaining: sum("remaining"),
        resetAt: rows.find((r) => r.expiresAt)?.expiresAt || null,
      };
    };
    // Preferred: the web console's real per-row detail, when a synced session
    // exists and belongs to this same account (userId cross-check guards
    // against a stale/mismatched cookie attributing someone else's credits).
    const webSession = providerSpecificData?.creditDaddyWebSession;
    // A synced session that yields nothing usable (expired cookie, owner
    // mismatch, changed response shape) is issue #44's failure mode: the
    // fallback is the openapi aggregate, and on accounts whose userQuota
    // zeroes out the plan row then silently disappears. Track usability so
    // the return value can flag that (see `webSessionExpired` below).
    let webSessionUsable = false;
    if (webSession?.cookie) {
      const web = await fetchQoderWebPacks(webSession.cookie, providerId, proxyOptions);
      const owner = providerSpecificData?.userId || null;
      if (web && (!owner || !web.sourceUserId || owner === web.sourceUserId)) {
        webSessionUsable = true;
        // 套餐内 Credits 本身也是一个资源包（用户定版 2026-10-01）：plan 行并入
        // 包序列按到期日混排，随资源包一起进池、进逐包明细，不再单独成行。
        // 保留 "Plan Credits" 名称（i18n: 套餐内 Credits），明细里认得出它。
        addOnPacks = [
          ...web.planRows.map((p) => ({ ...p, name: "Plan Credits" })),
          ...web.packs,
        ].sort((a, b) => String(a.expiresAt || "9999").localeCompare(String(b.expiresAt || "9999")));
        addOnResetAt = addOnPacks[0]?.expiresAt || null;
        webPlan = sumWebRows(web.planRows);
        webOrg = sumWebRows(web.orgRows);
      }
    }
    const hasWebPacks = addOnPacks.length > 0;
    if (!hasWebPacks) try {
      const campBase = providerId === "qoder-cn" ? QODER_CN_OPENAPI_BASE : QODER_OPENAPI_BASE;
      const campUrl = `${campBase}/sash/api/v1/me/campaigns?clientType=10`;
      const campRes = await proxyAwareFetch(
        campUrl,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Cosy-ClientType": "10",
            "Cosy-Version": "0.3.3",
            "User-Agent": "Qoder",
            Accept: "application/json",
          },
        },
        proxyOptions,
      );
      if (campRes.ok) {
        const campBody = await campRes.json().catch(() => null);
        const resolved = buildQoderAddOnPacks({
          campaigns: campBody?.campaigns || [],
          used: Number(addOnQuota.used) || 0,
          total: Number(addOnQuota.total) || 0,
        });
        addOnPacks = resolved.packs;
        addOnResetAt = resolved.resetAt;
      }
    } catch {
      // Best-effort breakdown fetch
    }

    // Web rows win over the openapi aggregates: they are the exact per-row
    // source (CreditDaddy's model — detail replaces the aggregate), and the
    // openapi userQuota zeroes out on accounts whose plan credits only surface
    // via the web console.
    const planBucket = webPlan || {
      total: Number(userQuota.total) || 0,
      used: Number(userQuota.used) || 0,
      remaining: Number(userQuota.remaining) || 0,
    };
    const orgBucket = webOrg || {
      total: Number(orgQuota.total) || 0,
      used: Number(orgQuota.used) || 0,
      remaining: Number(orgQuota.remaining) || 0,
    };
    // addOn 聚合以包明细为准（CreditDaddy 模型：明细替代聚合）——web 行已把
    // 套餐内 plan 行并入包序列，campaigns 路径的包也按 openapi 聚合对账
    // （buildQoderAddOnPacks 追加 unitemized 余量），两条路的 packSum 都自洽。
    // openapi addOnQuota 在部分账号整体置零，绝不能在包存在时压过包和。
    const packSum = (k) => addOnPacks.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    const addOnBucket = addOnPacks.length > 0
      ? { total: packSum("total"), used: packSum("used"), remaining: packSum("remaining") }
      : { total: Number(addOnQuota.total) || 0, used: Number(addOnQuota.used) || 0, remaining: Number(addOnQuota.remaining) || 0 };
    const quotas = {
      user: {
        total: planBucket.total,
        used: planBucket.used,
        remaining: planBucket.remaining,
        unit: userQuota.unit || "credits",
        resetAt: planBucket.resetAt || resetAt,
        unlimited: false,
      },
      addOn: {
        total: addOnBucket.total,
        used: addOnBucket.used,
        remaining: addOnBucket.remaining,
        unit: addOnQuota.unit || "credits",
        resetAt: addOnResetAt,
        unlimited: false,
        packs: addOnPacks,
      },
      organization: {
        total: orgBucket.total,
        used: orgBucket.used,
        remaining: orgBucket.remaining,
        unit: orgQuota.unit || "credits",
        resetAt: orgBucket.resetAt || resetAt,
        unlimited: false,
      },
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
      // Synced a CreditDaddy web session but got nothing usable from it:
      // tell the caller so the dashboard can say why the plan row may be
      // incomplete, instead of failing silently (issue #44).
      ...(webSession?.cookie && !webSessionUsable ? { webSessionExpired: true } : {}),
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
