// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnections } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { isUsageEligible } from "@/shared/utils/usageEligibility";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { computeConnectionUsage } from "../[connectionId]/route.js";

/**
 * GET /api/usage/quotas — read-only quota overview of every usage-capable
 * provider connection, in the same normalized shape the dashboard's
 * Provider Limits cards render (parseQuotaData). Which connections count is the
 * dashboard's own rule (isUsageEligible) — disabled accounts included, as there.
 *
 * Built for external dashboards such as CreditDaddy: the guard lets it through
 * with a dashboard virtual key (sk-…) as well as the usual session/CLI token.
 * The response carries no credentials — ids, labels, account emails and quota
 * numbers only. Anyone holding a virtual key can read those emails.
 *
 * Upstream quota APIs are rate-sensitive and any virtual-key holder can call
 * this, so:
 *   - results are cached per connection for CACHE_TTL_MS;
 *   - `?force=1` skips that TTL but never refreshes a connection more often than
 *     FORCE_MIN_INTERVAL_MS — within it the cached result is returned;
 *   - concurrent requests for one connection share a single upstream call, even
 *     one still running after its caller gave up at the per-connection timeout.
 * Connections are fetched with bounded concurrency, so one slow provider cannot
 * stall the whole overview.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const FORCE_MIN_INTERVAL_MS = 30 * 1000;
const CONCURRENCY = 4;
const PER_CONNECTION_TIMEOUT_MS = 25_000;
const cache = new Map();    // connectionId → { at, entry }
const inflight = new Map(); // connectionId → Promise<entry> of the running upstream call

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function toEntry(connection, { status, body }) {
  if (status !== 200 || body?.error) return { quotas: [], error: body?.error || `HTTP ${status}` };
  return {
    plan: typeof body?.plan === "string" ? body.plan : null,
    quotas: parseQuotaData(connection.provider, body),
    message: typeof body?.message === "string" ? body.message : null,
    limitReached: body?.limitReached === true,
  };
}

// One upstream call per connection at a time. The result is cached when the
// call settles — also when the caller that started it already timed out, so the
// late answer is not thrown away. Errors are cached too (same TTL) so a broken
// connection is not re-hammered on every poll.
function refreshEntry(connection, force) {
  let pending = inflight.get(connection.id);
  if (!pending) {
    pending = computeConnectionUsage(connection, { force })
      .then((res) => toEntry(connection, res), (error) => ({ quotas: [], error: error.message }))
      .then((entry) => {
        entry.checkedAt = new Date().toISOString();
        cache.set(connection.id, { at: Date.now(), entry });
        return entry;
      })
      .finally(() => inflight.delete(connection.id));
    inflight.set(connection.id, pending);
  }
  return pending;
}

async function quotaEntry(connection, force) {
  const base = {
    id: connection.id,
    provider: connection.provider,
    providerName: AI_PROVIDERS[connection.provider]?.name || connection.provider,
    name: connection.name || null,
    email: connection.email || null,
    isActive: connection.isActive !== false,
    authType: connection.authType || null,
  };
  const hit = cache.get(connection.id);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (age < (force ? FORCE_MIN_INTERVAL_MS : CACHE_TTL_MS)) return { ...base, ...hit.entry, cached: true };

  try {
    const entry = await withTimeout(refreshEntry(connection, force), PER_CONNECTION_TIMEOUT_MS);
    return { ...base, ...entry, cached: false };
  } catch (error) {
    // Only the timeout lands here; the call keeps running and caches its result.
    return { ...base, quotas: [], error: error.message, checkedAt: new Date().toISOString(), cached: false };
  }
}

export async function GET(request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  let connections;
  try {
    connections = (await getProviderConnections()).filter(isUsageEligible);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const results = new Array(connections.length);
  let next = 0;
  const worker = async () => {
    while (next < connections.length) {
      const i = next++;
      results[i] = await quotaEntry(connections[i], force);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, connections.length) }, worker));

  // Drop cache entries of connections that no longer exist.
  const alive = new Set(connections.map((c) => c.id));
  for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);

  return Response.json({ generatedAt: new Date().toISOString(), connections: results });
}

export const __test__ = { cache, inflight, FORCE_MIN_INTERVAL_MS };
