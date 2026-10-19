// River AI（river.ai / console.river.ai）开放平台。按量计费渠道：控制台 Billing
// 现金 + 赠送余额（$25 免费额度），余额卡由 CreditDaddy 网页会话线推送
// （external-quota display-only，source: river-{userId}）——本注册表只管推理路由，
// 不做额度查询（console API 只认 WorkOS 会话，rv_ key 看不到余额）。
//
// 文档 https://docs.river.ai/（guides/inference + models and pricing，2026-10 实测）：
// base https://api.river.ai/v1，Bearer rv_ API key（console.river.ai/keys 创建）。
// dual-endpoint：Chat Completions 与 Responses 双活（/v1/responses 实测路由在位，
// 空 model 报 model_not_found 而非 404 路由缺失）；OpenAI SDK 直连。
// 模型均为文本+图像输入、流式、推理、函数调用；推理 token 计入输出预算与计费：
//   - deepseek-ai/DeepSeek-V4.1-Flash：1,048,576 上下文 / 384,000 输出，$0.12 / $0.48（缓存命中 $0.0024）
//   - zai-org/GLM-5.3-Flash：1,048,576 上下文 / 128K 输出，$0.12 / $0.40（缓存命中 $0.024）
// 模型 id 是上游命名空间全名（org/Model），按 /v1/models 实测原样入库，不做简称映射。
export default {
  id: "river",
  priority: 68,
  alias: "river",
  aliases: ["rv"],
  display: {
    name: "River AI",
    icon: "bolt",
    color: "#2563EB",
    textIcon: "RV",
    website: "https://river.ai",
    notice: {
      apiKeyUrl: "https://console.river.ai/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.river.ai/v1/chat/completions",
    validateUrl: "https://api.river.ai/v1/models",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.river.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "responses",
      baseUrl: "https://api.river.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash", contextWindow: 1048576, maxOutput: 384000 },
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash", contextWindow: 1048576, maxOutput: 131072 },
  ],
  // usage 卡 = 读 CreditDaddy 推送的本地余额快照（同名认领；rv_ key 本身查不到余额，
  // console 余额只认 WorkOS 会话）。未认领时卡面给改名指路文案，不再报 "not implemented"。
  features: {
    usage: true,
    usageApikey: true,
  },
};
