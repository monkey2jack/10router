import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";

/**
 * Core rerank handler — native payload pass-through, same posture as
 * systemoneCore (issue #29). Rerank has no OpenAI shape to pivot through (a
 * double hop would only drop fields), so the request goes up verbatim apart
 * from the model rewrite, and the response envelope is normalized without
 * touching `results`. URL/headers come from the registry's `rerankConfig`,
 * exactly like systemone's `systemoneConfig`.
 *
 * The shipped upstreams (Cohere / Jina / SiliconFlow) already share one
 * request dialect (query + documents + top_n) and one response dialect
 * (results[].index/relevance_score), so no per-provider adapter layer is
 * needed — a new provider comes online by declaring `rerankConfig` alone.
 *
 * Auth: every shipped rerank lane is API-key Bearer; there is no OAuth rerank
 * provider, so no refresh-retry block (systemoneCore parity).
 *
 * @returns {Promise<{ success: boolean, response: Response, usage?: object, status?: number, error?: string }>}
 */
export async function handleRerankCore({ body, modelInfo, credentials, log, onRequestSuccess }) {
  const { provider, model } = modelInfo;
  const cfg = PROVIDER_MEDIA[provider]?.rerankConfig;
  // Connection-level endpoint override (providerSpecificData.baseUrl) first,
  // registry default second — System One parity: the lane protocol is uniform,
  // self-hosted / gateway deployments only swap the address.
  const targetUrl = credentials?.providerSpecificData?.baseUrl || cfg?.baseUrl;
  if (!targetUrl) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support rerank.`,
    );
  }

  // Validate at the trust boundary; per-document shape is upstream's job.
  if (typeof body.query !== "string" || body.query.trim() === "") {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }
  if (!Array.isArray(body.documents) || body.documents.length === 0) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: documents (non-empty array)");
  }

  // noAuth free lanes carry accessToken "public" from the credential stub.
  const token = credentials?.apiKey || credentials?.accessToken;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(cfg?.headers || {}),
  };
  // Forward the client body verbatim except the model rewrite — providers
  // differ on optional knobs (top_n / return_documents / max_chunks_per_doc /
  // max_tokens_per_doc) and the honest gateway shape is "whatever your lane
  // accepts", not a lossy intersection.
  const requestBody = { ...body, model };

  log?.debug?.("RERANK", `${provider.toUpperCase()} | ${model} | docs=${body.documents.length}`);

  let providerResponse;
  try {
    providerResponse = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      ...(typeof AbortSignal?.timeout === "function"
        ? { signal: AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS) }
        : {}),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("RERANK", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("RERANK", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
  }

  // Envelope-only normalization: `results` passes through untouched (every
  // shipped upstream returns results[].index/relevance_score; whether the
  // document text rides along is the request's return_documents, upstream's
  // choice). A response without a results array is a broken lane, not a
  // silent empty list.
  if (!responseBody || typeof responseBody !== "object" || !Array.isArray(responseBody.results)) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${provider} returned no results array`);
  }
  const normalized = {
    ...responseBody,
    model: responseBody.model || `${provider}/${model}`,
  };

  if (onRequestSuccess) await onRequestSuccess();

  const usage = extractRerankUsage(responseBody);
  log?.debug?.("RERANK", `Success | results=${responseBody.results.length} | usage=${JSON.stringify(usage || {})}`);

  return {
    success: true,
    usage,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

/**
 * Token accounting for the usage ledger. Jina / SiliconFlow report real input
 * token counts in `usage`; Cohere v2 reports `meta.billed_units.search_units`,
 * a REQUEST count, not tokens — mapping it into prompt_tokens is exactly how
 * cost charts start lying, so it is deliberately not recorded (the row still
 * renders, it just bills 0 until an exact number exists — embeddings' strict
 * exact-usage posture).
 */
function extractRerankUsage(body) {
  const u = body?.usage;
  if (!u || typeof u !== "object") return null;
  // Jina reports total_tokens only; SiliconFlow echoes prompt_tokens too.
  // Any real token count wins; a request counter (Cohere) never does.
  const total = Number.isSafeInteger(u.total_tokens) ? u.total_tokens : null;
  const prompt = Number.isSafeInteger(u.prompt_tokens) ? u.prompt_tokens
    : Number.isSafeInteger(u.input_tokens) ? u.input_tokens
    : total;
  if (!Number.isSafeInteger(prompt) || prompt <= 0) return null;
  return { prompt_tokens: prompt, completion_tokens: 0, total_tokens: total ?? prompt };
}
