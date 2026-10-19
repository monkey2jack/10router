// APInex — third-party prepaid AI gateway (apinex.bond), OpenAI-compatible.
// Bearer (or x-api-key) auth; chat completions at /v1/chat/completions.
// Base: https://api.apinex.bond/v1
// Catalog refreshed live 2026-10-02 (36 models; ids are now BARE except the
// free/* tier — the original 2026-09 vendor-prefixed "gpt/5.6-sol" scheme is
// gone). free/* models are paywalled per-day: the gateway answers
// billing_error "Daily check-in required" until the account signs in at
// apinex.bond/airdrop?tab=quests; paid rows answer 402 "Insufficient balance"
// at $0 (probe verdicts 2026-10-02 with a real key).
export default {
  id: "apinex",
  alias: "apinex",
  display: {
    name: "APInex",
    icon: "bolt",
    color: "#C9A227",
    textIcon: "AX",
    website: "https://apinex.bond/",
    notice: {
      text: "Prepaid USD-credit gateway with gamified rewards (XP/airdrop). free/* models require a DAILY check-in at the airdrop page; paid models bill a prepaid balance (402 otherwise). Third-party reseller — treat as untrusted for sensitive traffic.",
      apiKeyUrl: "https://apinex.bond/register",
      inviteCode: "SLEWP68C",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.apinex.bond/v1/chat/completions",
    validateUrl: "https://api.apinex.bond/v1/models",
  },
  serviceKinds: ["llm"],
  hasFree: true,
  models: [
    { id: "claude-fable-5.1", name: "Claude Fable 5.1" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
    { id: "grok-4.7", name: "Grok 4.7" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "free/claude-opus-4.6", name: "Claude Opus 4.6 (Free)" },
    { id: "free/claude-sonnet-4.6", name: "Claude Sonnet 4.6 (Free)" },
    { id: "free/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731 (Free)" },
    { id: "free/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813 (Free)" },
    { id: "free/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "free/gemini-3.1-pro", name: "Gemini 3.1 Pro (Free)" },
    { id: "free/gemini-3.8-flash", name: "Gemini 3.8 Flash (Free)" },
    { id: "free/glm-5.3-flash", name: "GLM-5.3 Flash (Free)" },
    { id: "free/gpt-6-luna", name: "GPT-6 Luna (Free)" },
    { id: "free/hy4", name: "HY4 (Free)" },
    { id: "free/kimi-k2.8", name: "Kimi K2.8 (Free)" },
    { id: "free/kimi-k3", name: "Kimi K3 (Free)" },
    { id: "free/mimo-v2.6-flash", name: "MiMo V2.6 Flash (Free)" },
    { id: "free/mimo-v2.6-pro", name: "MiMo V2.6 Pro (Free)" },
    { id: "free/minimax-m3", name: "MiniMax M3 (Free)" },
    { id: "free/minimax-m3.1", name: "MiniMax M3.1 (Free)" },
    { id: "free/muse-spark-1.3", name: "Muse Spark 1.3 (Free)" },
    { id: "free/qwen-3.8-max", name: "Qwen 3.8 Max (Free)" },
  ],
};
