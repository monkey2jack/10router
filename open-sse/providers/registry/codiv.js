// Codiv (codiv.ai) — open System One decision models + OpenAI-compatible text generation.
//
// 官方文档：https://codiv.ai/docs
// API Key 申请：https://codiv.ai/signup / https://codiv.ai/dashboard
// 官方 API（2026-10 实测验证）：
//   - System One 决策端点：POST https://api.codiv.ai/v1/systemone
//     （state + typed questions: noul/choice/score → calibrated probabilities）
//   - Chat Completions 端点：POST https://api.codiv.ai/v1/chat/completions
//     （diffusiongemma-26b 文本生成）
//   - 模型列表端点：GET https://api.codiv.ai/v1/models
//   - 鉴权：Authorization: Bearer sk-codiv-...
export default {
  id: "codiv",
  priority: 44,
  alias: "codiv",
  aliases: ["cdv"],
  display: {
    name: "Codiv",
    icon: "psychology",
    color: "#101D30",
    textIcon: "CD",
    website: "https://codiv.ai",
    notice: {
      text: "Codiv serves open System One decision models that answer typed questions with calibrated probabilities, plus DiffusionGemma text generation.",
      apiKeyUrl: "https://codiv.ai/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.codiv.ai/v1/chat/completions",
    validateUrl: "https://api.codiv.ai/v1/models",
  },
  models: [
    // System One decision models (zero-chat JSON endpoint)
    { id: "openjev-latest", name: "OpenJev Latest (Calibrated)", kind: "systemone" },
    { id: "openjev-0.1", name: "OpenJev 0.1", kind: "systemone" },
    { id: "laya-1.0", name: "Laya 1.0 (ModernBERT)", kind: "systemone" },
    { id: "verdict-1.4", name: "Verdict 1.4 (ModernBERT)", kind: "systemone" },
    { id: "clm-v0.1", name: "CLM v0.1 (Qwen3-8B)", kind: "systemone" },
    { id: "jevk5-0.3", name: "JevK5 v0.3 (Qwen3.5-4B)", kind: "systemone" },
    { id: "clef-flash-1.0", name: "Clef Flash 1.0 (Cloudflare)", kind: "systemone" },
    // Chat completion models
    { id: "diffusiongemma-26b", name: "DiffusionGemma 26B" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://api.codiv.ai/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
