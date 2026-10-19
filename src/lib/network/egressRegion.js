/**
 * Detect egress IP and region using a resilient multi-source fallback chain:
 * 1. IP.SB (https://api.ip.sb/geoip)
 * 2. ipwho.is (https://ipwho.is/)
 * 3. ipapi.is (https://api.ipapi.is)
 *
 * Modeled after the standard mihomo / Clash dashboard probe set: free, keyless,
 * fast, and mutually redundant.
 *
 * Used to intelligently recommend/pre-select cluster endpoints (e.g. for
 * Xiaomi Token Plan: cn / sgp / ams) and provide helpful proxy guidance
 * for region-bound models (e.g. Xiaomi MiMo desktop preview models).
 */

const DEFAULT_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// European countries mapped to Amsterdam (ams) cluster
const EUROPEAN_COUNTRY_CODES = new Set([
  "NL", "DE", "FR", "GB", "IT", "ES", "SE", "CH", "BE", "AT",
  "PL", "IE", "NO", "FI", "DK", "PT", "CZ", "RO", "HU", "GR",
]);

// Greater China mapped to China (cn) cluster
const GREATER_CHINA_CODES = new Set(["CN", "HK", "MO", "TW"]);

export const GEOIP_PROVIDERS = [
  {
    name: "ip.sb",
    url: "https://api.ip.sb/geoip",
    parse: (data) => ({
      countryCode: (data?.country_code || "").trim().toUpperCase(),
      country: (data?.country || "").trim(),
      ip: (data?.ip || "").trim(),
    }),
  },
  {
    name: "ipwho.is",
    url: "https://ipwho.is/",
    parse: (data) => {
      if (data?.success === false) return null;
      return {
        countryCode: (data?.country_code || "").trim().toUpperCase(),
        country: (data?.country || "").trim(),
        ip: (data?.ip || "").trim(),
      };
    },
  },
  {
    name: "ipapi.is",
    url: "https://api.ipapi.is",
    parse: (data) => ({
      countryCode: (data?.location?.country_code || data?.country_code || "").trim().toUpperCase(),
      country: (data?.location?.country || data?.country || "").trim(),
      ip: (data?.ip || "").trim(),
    }),
  },
];

let cachedResult = null;
let cacheExpiresAt = 0;

/**
 * Map country code to Xiaomi Token Plan region.
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {"cn" | "ams" | "sgp"}
 */
export function mapCountryToXiaomiTokenplanRegion(countryCode) {
  if (!countryCode || typeof countryCode !== "string") return "sgp";
  const upper = countryCode.trim().toUpperCase();
  if (GREATER_CHINA_CODES.has(upper)) return "cn";
  if (EUROPEAN_COUNTRY_CODES.has(upper)) return "ams";
  return "sgp";
}

/**
 * Fetch egress geoip data trying providers in order until one succeeds.
 * Fail-open: returns null on error/timeout across all providers, never throws.
 *
 * @param {object} [options]
 * @param {boolean} [options.bypassCache=false]
 * @param {number} [options.timeoutMs=2500]
 * @param {Function} [options.fetchFn] - for testing
 * @returns {Promise<{ countryCode: string, country: string, ip: string, source: string, recommendedRegions: object } | null>}
 */
export async function getEgressRegion({ bypassCache = false, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch } = {}) {
  const now = Date.now();
  if (!bypassCache && cachedResult && now < cacheExpiresAt) {
    return cachedResult;
  }

  for (const provider of GEOIP_PROVIDERS) {
    try {
      const res = await fetchFn(provider.url, {
        headers: {
          "User-Agent": "10Router",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const parsed = provider.parse(data);
      if (!parsed || !parsed.countryCode) continue;

      const tokenplanRegion = mapCountryToXiaomiTokenplanRegion(parsed.countryCode);
      const result = {
        countryCode: parsed.countryCode,
        country: parsed.country,
        ip: parsed.ip,
        source: provider.name,
        recommendedRegions: {
          "xiaomi-tokenplan": tokenplanRegion,
        },
      };

      cachedResult = result;
      cacheExpiresAt = now + CACHE_TTL_MS;
      return result;
    } catch {
      // Try next provider on timeout or error
      continue;
    }
  }

  // If all providers failed, return stale cache if available, else null
  return cachedResult || null;
}

/** Reset cache (primarily for unit tests). */
export function _resetEgressRegionCache() {
  cachedResult = null;
  cacheExpiresAt = 0;
}
