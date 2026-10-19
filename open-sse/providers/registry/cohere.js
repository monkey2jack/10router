export default {
  id: "cohere",
  priority: 90,
  alias: "cohere",
  display: {
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    notice: {
      apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    },
  },
  category: "apikey",
  // Rerank 是 Cohere 的看家线(issue #29): /v2/rerank, Bearer key 与 chat 同一把
  // (dashboard.cohere.com/api-keys)。计费按 search_units(请求次数)而非 token,
  // 响应里只有 meta.billed_units——usage 台账刻意不记, 免得成本图说谎。
  serviceKinds: ["llm", "rerank"],
  rerankConfig: {
    baseUrl: "https://api.cohere.com/v2/rerank",
    authType: "apikey",
    authHeader: "bearer",
    models: [
      { id: "rerank-v4.0-pro", name: "Rerank v4.0 Pro" },
      { id: "rerank-v3.5", name: "Rerank v3.5" },
    ],
  },
  transport: {
    baseUrl: "https://api.cohere.ai/v1/chat/completions",
    validateUrl: "https://api.cohere.ai/v1/models",
  },
  models: [
    { id: "command-r-plus-08-2024", name: "Command R+ (Aug 2024)" },
    { id: "command-r-08-2024", name: "Command R (Aug 2024)" },
    { id: "command-a-03-2025", name: "Command A (Mar 2025)" },
  ],
};
