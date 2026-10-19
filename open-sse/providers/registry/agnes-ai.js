// Agnes AI — International site (agnes-ai.com), OpenAI-compatible gateway.
// Bearer auth; chat completions at /v1/chat/completions. Base: https://apihub.agnes-ai.com/v1
// Fixed catalog (not per-credential); text chat models probed live from /v1/models 2026-09-03.
export default {
  id: "agnes-ai",
  alias: "agnes-ai",
  display: {
    name: "Agnes AI",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "AG",
    website: "https://www.agnes-ai.com/",
    notice: {
      apiKeyUrl: "https://www.agnes-ai.com/",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  serviceKinds: ["llm", "image"],
  // Image models: OpenAI-style POST /v1/images/generations (same key as chat).
  // 2.1/2.5 use tier-based size ("1K"/"2K"/"3K"/"4K" + optional ratio) but also
  // accept legacy exact sizes (e.g. 1024x768); 2.0 uses exact sizes directly.
  imageConfig: { baseUrl: "https://apihub.agnes-ai.com/v1/images/generations" },
  models: [
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash" },
    { id: "agnes-2.5-pro", name: "Agnes 2.5 Pro" },
    // 2.5-pro-beta / 3.0-flash 是上游目录里新出现的文本模型种子，未随 2026-09-03
    // 的 /v1/models 探测落表，按同一形状补上，让新账号在手填名单前就有可选项。
    { id: "agnes-2.5-pro-beta", name: "Agnes 2.5 Pro Beta" },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash" },
    { id: "agnes-image-2.0-flash", name: "Agnes Image 2.0 Flash", params: ["size"], kind: "image" },
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", params: ["size"], kind: "image", capabilities: ["edit"] },
    { id: "agnes-image-2.5-flash", name: "Agnes Image 2.5 Flash", params: ["size"], kind: "image", capabilities: ["edit"] },
  ],
};
