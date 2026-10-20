// Token Plan（国内版）— credit 订阅 key，走 token-plan.cn-beijing.maas.aliyuncs.com。
// 国际版是同一条产品线的 ap-southeast-1 区域（见 alitp-intl.js），两把 key 互不通用：
// 国内 key 打国际端点、国际 key 打国内端点都回 401 InvalidApiKey。
//
// 与同厂商另外两类 key 的区别（三类都要分开建卡，否则用户必然配错）：
//   · Coding Plan（alicode / alicode-intl）→ coding.dashscope.aliyuncs.com
//   · Model Studio 按量（alims / alims-intl）→ dashscope.aliyuncs.com/compatible-mode
//   · Token Plan（本文件 / alitp-intl）→ token-plan.<region>.maas.aliyuncs.com
//
// 配额：暂无公开端点。2026-10-20 用一个真实国内 key 探测 /api/v1/quota、
// /api/v1/billing/*、/compatible-mode/v1/dashboard/billing/* 等 20 余条路径全部
// 404，推理响应体与响应头也不带额度字段——「免费额度」表只在百炼控制台网页侧
// 展示（按模型 code 逐条列出「剩 1M / 共 1M + 到期时间」）。因此本 key 的配额卡片
// 走 usage handler 的人话说明，而不是假的空额度。
export default {
  id: "alitp-cn",
  priority: 11,
  alias: "alitp-cn",
  display: {
    name: "Alibaba Token Plan (CN)",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ATP",
    website: "https://bailian.console.aliyun.com/cn-beijing/subscription/overview",
    notice: {
      apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
};
