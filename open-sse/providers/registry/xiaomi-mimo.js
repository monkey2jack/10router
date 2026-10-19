import { CLAUDE_API_HEADERS } from "../shared.js";

// Dual auth (same pattern as kimi):
//   - API key (sk-...)      → cloud API on api.xiaomimimo.com
//   - Xiaomi account sign-in → same cloud host.
// The Desktop-exclusive Preview models used to live here; they moved to the
// `mimo-desktop` card, which owns the account-session surface. This card keeps
// the browser sign-in + sk- key flow for the cloud models.
// Endpoint is picked per model in the executor, same as opencode-go's /responses split.
export default {
  id: "xiaomi-mimo",
  // Ordering inside the providers page (lower = earlier within a tier; the
  // connection-state rank is the primary axis). Was 290 — inherited from the
  // upstream PR where the provider was brand new — which sank it below every
  // configured provider. 20 sits with the other subscription-backed providers
  // (antigravity / gemini-cli / nvidia).
  priority: 20,
  alias: "xiaomi-mimo",
  aliases: [
    "mimo",
  ],
  uiAlias: "mimo",
  display: {
    name: "Xiaomi MiMo",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "XM",
    website: "https://xiaomimimo.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com/console/api-keys",
      // Cloud card → cloud console. This used to point at the Desktop invite page,
      // which sent anyone signing up here to the desktop app instead of the API
      // console they actually need a billing key from.
      signupUrl: "https://platform.xiaomimimo.com/",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  serviceKinds: ["llm", "tts"],
  transport: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    validateUrl: "https://api.xiaomimimo.com/v1/models",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.xiaomimimo.com/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    // The account-session models live on the `mimo-desktop` card
    // (registry/mimo-desktop.js), which owns the Desktop cookie surface. This card
    // advertises none of them: a cloud key cannot reach that route.
    // Both cards now list the same V2.6 ids on purpose — the PROVIDER id is what
    // separates "billed by the cloud API" from "spends Desktop credits", so the
    // executor keys its session path on the provider, never on the model id.
    // Cloud API models (api.xiaomimimo.com/v1), aligned 2026-09-22 with the
    // platform model list (mimo.mi.com/docs, page updated 2026-09-21):
    //   • V2.6 generation added — pro and flash. Both 1M context / 128K max
    //     output, full-modal understanding, RPM 100 / TPM 10M.
    //   • mimo-v2.5 and mimo-v2.5-pro dropped — the platform retires them at
    //     2026-10-21 10:00 CST. Dropping an id here only removes it from the
    //     picker: the registry is not a request gate (isValidModel has no
    //     callers and getModelUpstreamId falls through to the raw id), so a
    //     combo already pointing at mimo-v2.5-pro keeps routing until upstream
    //     actually cuts over.
    //   • mimo-v2.6-pro-ultraspeed IS listed — here, on the Token Plan card and
    //     on mimo-desktop (2026-09-27 user decision). Upstream marks it 定制服务
    //     (contact sales) on the open API, so a key/session without that contract
    //     gets an upstream error; listing it anyway lets a contracted user call it
    //     out of the box instead of hand-adding a custom model just to try it.
    // Earlier removals still stand: the V2 generation (mimo-v2-omni,
    // mimo-v2-flash) and the no-longer-sold mimo-v2.5-pro-ultraspeed.
    // The -tts family belongs to the TTS media provider surface (serviceKinds
    // includes "tts"; the media page lists exactly the kind:"tts" entries below)
    // and is still the V2.5 generation upstream, so it stays as-is.
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
    // 定制服务 upstream — see the note above; listed for out-of-the-box access.
    { id: "mimo-v2.6-pro-ultraspeed", name: "MiMo V2.6 Pro UltraSpeed" },
    { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", kind: "tts" },
  ],
  ttsConfig: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    authType: "apikey",
    authHeader: "bearer",
    format: "xiaomi-mimo-tts",
  },
  features: {
    usage: true,
    // API-key connections hit the same quota path via the account session, so
    // isUsageEligible + /api/usage must allow non-oauth authType too.
    usageApikey: true,
  },
  // Custom OAuth — non-standard ECDH encrypted-callback flow.
  // Handled by the Xiaomi MiMo OAuth service, not the generic PKCE pipeline.
  oauth: {
    custom: true,
    authorizeUrl: "https://platform.xiaomimimo.com/authorize",
    // The callback carries ?u=<ECDH-encrypted payload> instead of ?code=.
    // Decryption yields { uid, sk, url }.
    callbackParam: "u",
    kn: "mimocode",
  },
};
