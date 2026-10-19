// Muse (Meta Model API) —— 双认证（同 kimi 的模式，思路对齐上游 decolua/9router
// 28809807）：
//   oauth  = Muse Code 订阅（Meta 账号 device code，登录后铸造 LLM|… 前缀的
//            Model API key，聊天请求实际携带的就是这把 key）
//   apikey = dev.meta.ai 的按量付费 Model API key
// 两种凭证共用同一 transport；订阅账号经 museHeaders hook 额外带 x-api-version
//（纯 API key 不带已可用）。Meta 订阅流程不发 refresh token → 401 即重新登录。
export default {
  id: "muse",
  priority: 120,
  alias: "muse",
  aliases: [
    "muse-ai",
    "meta-model-api",
    "muse-code",
    "muse-subscription",
  ],
  uiAlias: "muse",
  display: {
    name: "Muse (Meta Model API)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MU",
    website: "https://muse.ai",
    notice: {
      text: "Sign in with your Meta account (Muse Code subscription) or paste a Model API key from dev.meta.ai. Subscription keys are minted per account; Meta may train on contributor-tier data.",
      apiKeyUrl: "https://dev.meta.ai",
      signupUrl: "https://muse.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    modelsUrl: "https://api.meta.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
  },
  // 多端点：同一把 key 上 Meta 同时接受 Chat Completions 与 Responses 两种线
  // 协议（https://dev.meta.ai/docs/protocols）。Muse Spark 的推理过程
  // （含 encrypted_content 回放）只有 Responses 能原样往返，故模型钉在
  // openai-responses 传输上。
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.meta.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
  ],
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  passthroughModels: true,
  oauth: {
    clientId: "1031625952748946",
    deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
    tokenUrl: "https://auth.meta.com/oidc/device/token/",
  },
};
