import { createHash } from "node:crypto";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Live catalog for the rotating Cline free-model shelf. The official Cline app
// renders this same feed, so it is Cline's own published list — not a scrape
// or a spoofed client:
//   GET https://api.cline.bot/api/v1/ai/cline/recommended-models
//   -> { recommended: [...], free: [{ id, name, description, tags }], clinePass: [...] }
//
// Only `free` is consumed here. The static paid list lives in
// providers/registry/cline.js and is unioned with this feed in
// src/app/api/v1/models/route.js — a failed fetch degrades to paid-only,
// never to an empty list.
const CLINE_RECOMMENDED_MODELS_ENDPOINT =
  "https://api.cline.bot/api/v1/ai/cline/recommended-models";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string }[] }>} */
const catalogCache = new Map();

function cacheKey(credentials) {
  const seed =
    credentials?.providerSpecificData?.userId
    || credentials?.email
    || credentials?.refreshToken
    || credentials?.accessToken
    || credentials?.apiKey
    || "anonymous";
  return createHash("sha256").update(`cline:${seed}`).digest("hex");
}

export function clearClineModelsCache() {
  catalogCache.clear();
}

/**
 * Fetch Cline's live free-model catalog.
 *
 * Mirrors resolveClinepassModels (clinepassModels.js): same auth headers, same
 * { models: [{ id, name }] } shape, same null-on-failure contract so
 * /v1/models falls back to the static registry list.
 *
 * The catalog endpoint answers without credentials, but callers still pass the
 * connection through so per-account shelves stay cache-isolated if Cline ever
 * personalizes the list.
 *
 * @param {object} credentials - Connection credentials ({ accessToken, apiKey, email, refreshToken, providerSpecificData })
 * @param {object} [options] - { log, proxyOptions, fetchFn }
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClineModels(credentials, options = {}) {
  const { log = null, proxyOptions = null, fetchFn = null } = options;
  const token = credentials?.apiKey || credentials?.accessToken;

  const key = cacheKey(credentials);
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.models.length) {
    return { models: cached.models };
  }

  const doFetch = fetchFn || proxyAwareFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = credentials?.apiKey
      ? { Accept: "application/json", Authorization: `Bearer ${token}` }
      : buildClineHeaders(token || "", { Accept: "application/json" });
    if (!token) delete headers.Authorization;
    // X-Task-ID mirrors third-party Cline clients (e.g. Cline-proxy) that
    // stamp catalog syncs so upstream can distinguish them from chat traffic.
    headers["X-Task-ID"] = `10router_models_sync_${Date.now()}`;

    const response = await doFetch(
      CLINE_RECOMMENDED_MODELS_ENDPOINT,
      { method: "GET", headers, cache: "no-store", signal: controller.signal },
      proxyOptions,
    );
    if (!response.ok) return null;

    const json = await response.json();
    const free = Array.isArray(json?.free) ? json.free : [];
    const models = free
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({ id: m.id.trim(), name: m.name || m.id.trim() }));
    if (!models.length) return null;

    catalogCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, models });
    log?.debug?.("CLINE", `synced ${models.length} free models from recommended-models`);
    return { models };
  } catch (err) {
    log?.debug?.("CLINE", `live model fetch failed: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
