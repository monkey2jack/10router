/**
 * Xiaomi MiMo usage — weekly quota from the Xiaomi account session.
 *
 * Primary path (mimo-desktop card only): GET the account service with the
 * account-session cookie (see shared/mimoAccount.js). Response: { code: 0, data:
 * { percent (remaining %), resetDate, resetAt } }.
 *
 * The weekly allowance is a MiMo Desktop beta surface. The cloud card
 * (xiaomi-mimo) bills through the plan / API at formal rates and owns NO quota to
 * show, so it answers with a short "no separate quota" note — never a weekly-quota
 * prompt (2026-09 user reports: a "每周配额需要小米账号会话…" notice is wrong
 * regardless of whether the key can read it, and an empty quota card reads as
 * broken).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { getMimoAccountUsage } from "../../shared/mimoAccount.js";

const USAGE_URL = "https://aistudio.xiaomimimo.com/open-apis/v1/user/usage";

// A Desktop-card connection stores this placeholder where an API-key connection
// stores an sk- key (see /api/oauth/xiaomi-mimo/api-key). Sending it as a Bearer
// token authenticates nobody, so the handler treats it as "no key" and says what is
// actually true. Kept as ONE fixed sentence: the dashboard translates a quota
// message by exact text match, so it must not interpolate.
const SESSION_TOKEN_PREFIX = "mimo-desktop-session";
const NO_DESKTOP_SESSION_MESSAGE =
  "MiMo Desktop is not signed in on this machine — sign in to it to read the weekly quota.";

// The cloud card has no quota surface: it bills per use at the plan / API formal
// rates. Say that on the usage page instead of leaving an empty quota card (2026-09
// user report: an empty card reads as broken). This is the OPPOSITE of a weekly-quota
// prompt — it affirms there is no quota, so it does not re-introduce the notice the
// card was told not to show. ONE fixed sentence: the dashboard translates a quota note
// by exact text match, so it must not interpolate (zh-CN / zh-TW in public/i18n/literals).
const CLOUD_NO_QUOTA_MESSAGE =
  "Billed at standard API / plan rates — no separate quota to display.";

/**
 * @param {string|null|undefined} accessToken - sk- API key
 * @param {object|null} providerSpecificData - may contain mimoPassToken, uid, etc.
 * @param {object|null} proxyOptions
 * @param {object} [options]
 * @param {boolean} [options.allowMachineSession=true] - is this the Desktop card?
 *   True reads this machine's MiMo Desktop cookie store for the weekly allowance.
 *   False is the cloud card (xiaomi-mimo): it owns no quota surface at all, so the
 *   handler short-circuits to a "no separate quota" note instead of probing
 *   sessions or keys (reading the machine store there once made it advertise a
 *   Desktop session, and the key probe's 401 fallback made it advertise a weekly
 *   quota — neither is its to report; an empty card, in turn, reads as broken).
 */
export async function getXiaomiMimoUsage(
  accessToken = null,
  providerSpecificData = null,
  proxyOptions = null,
  { allowMachineSession = true } = {},
) {
  if (!allowMachineSession) {
    return { plan: "Xiaomi MiMo", message: CLOUD_NO_QUOTA_MESSAGE };
  }

  // Preferred path: the weekly quota comes from the account service session
  // (mimo-server /api/user/usage), which the sk- key cannot reach. The session is
  // derived from MiMo Desktop's persisted passToken via the SSO/sts handshake.
  const account = await getMimoAccountUsage(providerSpecificData, proxyOptions);
  if (typeof account.percent === "number" && Number.isFinite(account.percent)) {
    return { plan: "Xiaomi MiMo Desktop", quotas: { Weekly: toWeeklyQuota(account.percent, account.resetAt, account.resetDate) } };
  }

  // Fallback: no account session available (Desktop never logged in, or its cookie
  // store is locked). The sk- key cannot read the quota, so surface a clear message.
  const key = accessToken || providerSpecificData?.apiKey;
  const trimmedKey = typeof key === "string" ? key.trim() : "";
  if (trimmedKey.startsWith(SESSION_TOKEN_PREFIX)) {
    // Desktop card: there is no sk- key on this card to fall back to — saying
    // "add credentials" would send the user to a key path the card no longer has.
    return { plan: "Xiaomi MiMo Desktop", message: NO_DESKTOP_SESSION_MESSAGE };
  }
  if (!trimmedKey) {
    return { message: "Xiaomi MiMo Desktop not connected. Add credentials to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          "X-Mimo-Source": "mimocode-cli",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
      proxyOptions,
    );

    if (response.status === 401) {
      return {
        plan: "Xiaomi MiMo Desktop",
        message: "Weekly quota requires Xiaomi account session. API key alone is insufficient.",
      };
    }

    if (!response.ok) {
      return { plan: "Xiaomi MiMo Desktop", message: `Usage API error (${response.status})` };
    }

    const data = await response.json().catch(() => null);
    if (!data || data.code !== 0 || !data.data) {
      return { plan: "Xiaomi MiMo Desktop", message: "Usage endpoint returned unexpected response." };
    }

    const { percent, resetDate, resetAt } = data.data;
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
      return { plan: "Xiaomi MiMo Desktop", message: "Usage data missing percent field." };
    }

    return { plan: "Xiaomi MiMo Desktop", quotas: { Weekly: toWeeklyQuota(percent, resetAt, resetDate) } };
  } catch (error) {
    return { message: `Xiaomi MiMo Desktop usage error: ${error.message}` };
  }
}

// Message shown for a Token Plan connection with nothing readable. Kept as ONE
// fixed English sentence on purpose: the dashboard renders quota messages
// verbatim, and the DOM-level i18n runtime translates a text node only on an
// exact match — so a sentence without interpolation is translatable as-is
// (zh-CN / zh-TW entries live in public/i18n/literals).
const TOKENPLAN_NO_QUOTA_MESSAGE =
  "Token Plan does not expose a quota API for standalone keys — check your plan usage in the MiMo console.";

/**
 * MiMo Token Plan (tp- keys, token-plan-<region>.xiaomimimo.com).
 *
 * There is no plan-quota endpoint on that cluster: every candidate path on the
 * token-plan hosts answers 404 (openresty), and the account-service endpoint
 * that carries the weekly allowance rejects a tp- key with 401 (it wants a MiMo
 * account session). So there are only two possible answers:
 *
 *   1. the connection also carries a Desktop account session (mimoPassToken) —
 *      the weekly allowance is then readable, and we show it exactly like the
 *      base provider does;
 *   2. otherwise there is genuinely nothing to fetch. A raw "Usage API not
 *      implemented for xiaomi-tokenplan" is what the row used to display; say
 *      something true instead.
 */
export async function getXiaomiTokenPlanUsage(apiKey = null, providerSpecificData = null, proxyOptions = null) {
  // Only a session actually stored on THIS row counts. The weekly allowance is
  // MiMo Desktop's surface; a Token Plan key that borrows this machine's Desktop
  // cookie store would advertise a quota the plan does not own — the same rule
  // the cloud card enforces via allowMachineSession:false.
  if (providerSpecificData?.mimoPassToken) {
    const account = await getMimoAccountUsage(providerSpecificData, proxyOptions);
    if (typeof account.percent === "number" && Number.isFinite(account.percent)) {
      return { plan: "MiMo Token Plan", quotas: { Weekly: toWeeklyQuota(account.percent, account.resetAt, account.resetDate) } };
    }
  }

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "API key not available. Add a key to view usage." };
  }

  return { plan: "MiMo Token Plan", message: TOKENPLAN_NO_QUOTA_MESSAGE };
}

/**
 * Normalize the account-service payload into the dashboard's quota shape.
 * `percent` is the REMAINING percentage (94 means 94% left).
 * @param {number} percent
 * @param {number|string|undefined} resetAt — epoch seconds
 * @param {string|undefined} resetDate — "YYYY-MM-DD"
 */
function toWeeklyQuota(percent, resetAt, resetDate) {
  const remaining = Math.max(0, Math.min(100, Math.round(percent)));
  let resetIso = null;
  if (typeof resetAt === "number" && resetAt > 0) {
    resetIso = new Date(resetAt * 1000).toISOString();
  } else if (typeof resetDate === "string" && resetDate) {
    const parsed = new Date(`${resetDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) resetIso = parsed.toISOString();
  }
  return {
    used: 100 - remaining,
    total: 100,
    remainingPercentage: remaining,
    resetAt: resetIso,
    unlimited: false,
    // Weekly allowance: resetAt is the next refresh, not a final expiry —
    // the badge must survive a drained week (that's when users look for it).
    recurring: true,
  };
}
