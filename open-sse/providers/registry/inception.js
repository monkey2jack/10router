// Inception Labs — diffusion LLMs (dLLM), OpenAI-compatible first-party API.
// https://api.inceptionlabs.ai/v1/chat/completions（models 页官方示例原样）。
// 卖点：扩散模型并行解码，~1000+ tok/s（Mercury 3 官方标称 1068），质量对标
// GPT-6 Luna / Claude Haiku 5.5 的 cost-optimized 档。新 key 送 1 亿 tokens。
//
// 目录口径（docs.inceptionlabs.ai/get-started/models，2026-10-20）：
//   mercury-3        现役旗舰，1M ctx / 131072 out，tools + structured outputs，
//                    reasoning_effort: instant|low|medium|high，launch 半价
//                    $0.10/$0.35（原价 $0.20/$0.70）
//   mercury-voice    语音代理线，仅企业开通（联系 sales），128K / 50000 out
//   mercury-2.5 / 2  上一代，2026-10-19 起停售，存量用户 11-15 止
//   mercury-decide   决策模型走 v1/decisions 专端点，非 chat —— 不收录，
//                    与 System One 的 v1/chat/completions 决策通道不同形
// Temperature 仅 0.5–1.0 合法（docs 明示），越界会被上游拒绝。
export default {
  id: "inception",
  priority: 85,
  alias: "inception",
  aliases: ["inceptionlabs", "mercury"],
  uiAlias: "inception",
  display: {
    name: "Inception Labs",
    icon: "cyclone",
    color: "#0EA5E9",
    textIcon: "IN",
    website: "https://www.inceptionlabs.ai",
    notice: {
      text: "Diffusion LLMs at 1000+ tok/s. New API keys include 100M free tokens. mercury-voice requires enterprise access.",
      apiKeyUrl: "https://platform.inceptionlabs.ai/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.inceptionlabs.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    { id: "mercury-3", name: "Mercury 3", contextWindow: 1000000, maxOutput: 131072, reasoning: true },
    { id: "mercury-2.5", name: "Mercury 2.5 (legacy)", contextWindow: 260000, maxOutput: 65536, reasoning: true },
  ],
  serviceKinds: ["llm"],
};
