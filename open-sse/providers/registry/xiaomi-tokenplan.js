import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "xiaomi-tokenplan",
  // Sits directly under the base Xiaomi MiMo card (priority 20): same vendor,
  // same protocol — only the cluster (and who pays) differ.
  priority: 21,
  alias: "xiaomi-tokenplan",
  aliases: [
    "xmtp",
  ],
  uiAlias: "xmtp",
  display: {
    name: "MiMo Token Plan",
    icon: "smart_toy",
    color: "#FF6700",
    textIcon: "XT",
    website: "https://platform.xiaomimimo.com",
    notice: {
      text: "Xiaomi MiMo Token Plan subscription (API key starts with tp-). Token Plan keys are cluster-specific — select the region matching your subscription.",
      apiKeyUrl: "https://platform.xiaomimimo.com/console/api-keys",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  serviceKinds: ["llm", "tts"],
  regions: [
    { id: "cn", label: "China (中国大陆)" },
    { id: "sgp", label: "Singapore (新加坡)" },
    { id: "ams", label: "Amsterdam (阿姆斯特丹)" },
  ],
  // MiMo Desktop's own Token Plan preset is token-plan-cn; egress auto-match
  // picks the right cluster for overseas keys at add time regardless.
  defaultRegion: "cn",
  transport: {
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1/chat/completions",
    regions: {
      cn: "https://token-plan-cn.xiaomimimo.com/v1",
      sgp: "https://token-plan-sgp.xiaomimimo.com/v1",
      ams: "https://token-plan-ams.xiaomimimo.com/v1",
    },
    defaultRegion: "cn",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  // baseUrl omitted — region-dynamic, resolved in the executor's buildUrl.
  transports: [
    {
      format: "openai",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  // Aligned 2026-09-22 with the platform model list (mimo.mi.com/docs, page
  // updated 2026-09-21). Before that this mirrored MiMo Desktop's bundled plan
  // catalogs, where all three regions (token-plan-cn / -sgp / -ams) served the
  // IDENTICAL set. mimo-v2-omni was never in any plan catalog (billing-only,
  // since deprecated) — calling it here 404s, which is how this list earned the
  // "too old" reputation.
  //
  // V2.6 replaces the V2.5 chat line, which the platform retires 2026-10-21
  // 10:00 CST. As on the base card, dropping an id only removes it from the
  // picker — the registry is not a request gate — so an existing combo keeps
  // routing until upstream cuts over. The legacy mimo-v2-pro and mimo-v2-tts
  // entries go too: neither appears in the platform list any more. The TTS
  // family is still V2.5 upstream and stays.
  //
  // Verified for this cluster, not assumed: the Token Plan price page
  // (mimo.mi.com/static/docs/price/token-plan.md) states under Core Strengths
  // that "all plans support the latest flagship models mimo-v2.6-pro,
  // mimo-v2.6-flash, as well as ASR and TTS models" — all plans covering both
  // the individual and team editions — and the site's own V2.6 announcement
  // adds that 团队版 TokenPlan and the Batch API now carry V2.6. So the
  // token-plan-{region} hosts serve the same ids as the billing host.
  models: [
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
    { id: "mimo-v2.6-pro-claude", name: "MiMo V2.6 Pro (Claude Native)", targetFormat: "claude", upstreamModelId: "mimo-v2.6-pro" },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
    // 定制服务 upstream: a plan without the contract gets an upstream error. Listed
    // anyway so a contracted user calls it out of the box rather than hand-adding
    // a custom model (2026-09) — the base card lists it for the same reason.
    { id: "mimo-v2.6-pro-ultraspeed", name: "MiMo V2.6 Pro UltraSpeed" },
    { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", kind: "tts" },
    { id: "mimo-v2.5-tts-voiceclone", name: "MiMo V2.5 TTS Voice Clone", kind: "tts" },
    { id: "mimo-v2.5-tts-voicedesign", name: "MiMo V2.5 TTS Voice Design", kind: "tts" },
  ],
  // Same speech protocol as the base provider (shared adapter); only the cluster
  // URL differs and the adapter resolves it per connection/region.
  ttsConfig: {
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1/chat/completions",
    authType: "apikey",
    authHeader: "bearer",
    format: "xiaomi-mimo-tts",
  },
};
