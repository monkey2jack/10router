// MiMo official model catalog — api.xiaomimimo.com/v1/models (OpenAI shape).
// Backs the dashboard "Fetch MiMo Models" import button, mirroring the qoder
// live-catalog flow. Deliberately thin: no auth refresh dance, the connection
// stores a long-lived accessToken from the mimo OAuth step.

const MIMO_FALLBACK_ORIGIN = "https://api.xiaomimimo.com";

// Ids of the client-internal X-series entries are routed through the signed
// in-client path (openai|skip|proxy|xiaomi-client|...) and are NOT part of the
// public /v1/models sale list, so the import flow must not let an allow-listed
// upstream response shadow a fixed registry entry. The original
// mimo-x-pro-preview / mimo-x-flash-preview pair is retired, but the prefix filter
// stays defensive: it costs nothing and still catches any X-series id upstream
// may start returning. The Desktop card's current models (mimo-v2.6-pro/-flash)
// ARE public ids and are meant to be imported normally.
export const MIMO_CLIENT_PREVIEW_PREFIX = "mimo-x";

// Upstream /v1/models entries are bare {id, object, owned_by} — no kind
// metadata — so classify by id: the -tts family (incl. voiceclone/voicedesign
// variants) belongs to the TTS surface, -asr is speech-to-text. "llm" ids are
// the only ones the provider-page chat model list should ever show.
export function mimoModelKind(id) {
  const s = String(id).toLowerCase();
  if (s.includes("-tts") || s.includes("tts-")) return "tts";
  if (s.includes("-asr") || s.endsWith("asr")) return "stt";
  return "llm";
}

function mimoModelsUrl(connection = {}) {
  let origin = MIMO_FALLBACK_ORIGIN;
  try {
    const stored = connection.providerSpecificData?.baseUrl || connection.baseUrl;
    if (stored) origin = new URL(stored).origin;
  } catch {
    // malformed stored baseUrl — fall back to the official host
  }
  return `${origin}/v1/models`;
}

export async function resolveMimoModels(connection = {}, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const token = connection.accessToken || connection.apiKey;
  if (!token) {
    return { models: [], warning: "No MiMo access token on this connection." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(mimoModelsUrl(connection), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { models: [], warning: `MiMo /v1/models returned ${res.status}.` };
    }
    const data = await res.json();
    const raw = Array.isArray(data) ? data : data?.data || data?.models || [];
    const models = raw
      .map((m) => (typeof m === "string" ? m : m?.id || m?.name || m?.model))
      .filter(Boolean)
      .filter((id) => !String(id).startsWith(MIMO_CLIENT_PREVIEW_PREFIX))
      .map((id) => ({ id, name: id, kind: mimoModelKind(id) }));
    if (!models.length) {
      return { models: [], warning: "MiMo returned no models." };
    }
    return { models };
  } catch (error) {
    return { models: [], warning: `Failed to fetch MiMo models: ${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
}
