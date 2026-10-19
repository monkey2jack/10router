// ModelScope 魔搭（modelscope.cn）Serverless 推理服务平台。
//
// 官方文档：https://modelscope.cn/docs/
// 端点规格（2026-10 实测验证）：
// - Base: https://api-inference.modelscope.cn/v1/chat/completions
// - 鉴权：Authorization: Bearer <ModelScope SDK Token>
// - 格式：标准 OpenAI Chat Completions 协议
// - 模型命名：官方命名空间全名（如 Qwen/Qwen2.5-7B-Instruct 等）
// - 额度展示：魔方（Magicube）额度由 CreditDaddy 网页会话线签到并读取后推送
//   （external-quota display-only，source: modelscope-{userId}，isCreditBalance: true）
export default {
  id: "modelscope",
  priority: 69,
  alias: "modelscope",
  aliases: ["ms"],
  display: {
    name: "ModelScope",
    icon: "layers",
    color: "#624AFF",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: {
      apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
  },
  models: [
    // ── DeepSeek 系列（最新主力 + 深度推理） ───────────────────────
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash", contextWindow: 1000000, maxOutput: 384000 },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash", contextWindow: 1000000, maxOutput: 384000 },
    { id: "deepseek-ai/DeepSeek-V4-Pro-0813", name: "DeepSeek V4 Pro (0813)", contextWindow: 1000000, maxOutput: 384000 },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 128000, maxOutput: 64000 },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 128000, maxOutput: 64000 },
    // ── Qwen 系列（Qwen 3.x / 2.5 / Coder / 推理） ───────────────
    { id: "Qwen/Qwen3.8-Flash-Next", name: "Qwen 3.8 Flash Next", contextWindow: 262144, maxOutput: 64000 },
    { id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", contextWindow: 262144, maxOutput: 64000 },
    { id: "Qwen/Qwen3.5-397B", name: "Qwen 3.5 397B", contextWindow: 1000000, maxOutput: 65536 },
    { id: "Qwen/Qwen3.5-122B", name: "Qwen 3.5 122B", contextWindow: 1000000, maxOutput: 65536 },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B Instruct", contextWindow: 1000000, maxOutput: 64000 },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B Instruct", contextWindow: 262144, maxOutput: 64000 },
    { id: "Qwen/QwQ-32B", name: "QwQ 32B (Reasoning)", contextWindow: 131072, maxOutput: 64000 },
    // ── 旗舰与主流多模型（GLM / MiniMax / Kimi / StepFun / 百度） ───
    { id: "ZhipuAI/glm-5.2", name: "GLM 5.2", contextWindow: 1000000, maxOutput: 131072 },
    { id: "ZhipuAI/glm-5.3", name: "GLM 5.3", contextWindow: 1000000, maxOutput: 131072 },
    { id: "ZhipuAI/glm-5.3-flash", name: "GLM 5.3 Flash", contextWindow: 1000000, maxOutput: 131072 },
    { id: "MiniMax/MiniMax-M3", name: "MiniMax M3", contextWindow: 1000000, maxOutput: 131072 },
    { id: "Moonshot/Kimi-K3", name: "Kimi K3", contextWindow: 1048576, maxOutput: 131072 },
    { id: "stepfun-ai/Step-3.7-Flash", name: "Step 3.7 Flash", contextWindow: 128000, maxOutput: 64000 },
    { id: "baidu/ERNIE-4.5-300B", name: "ERNIE 4.5 300B", contextWindow: 200000, maxOutput: 64000 },
  ],
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
