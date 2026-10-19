// v1m（v1m.ir）— System One 校准决策引擎，与 drex（nace.ai）同一条
// /v1/systemone 决策 lane（上游 v0.5.95, 0a879c5c）：state + typed questions
// 进，校准概率评估出，零 chat 翻译层。Bearer key 由 systemoneCore 装配；
// 连接的 providerSpecificData.baseUrl 可覆盖默认端点（自建/网关场景，
// 见 systemoneCore.js）。API 无额度接口，不挂 usage 卡（features 不设）。
export default {
  id: "v1m",
  priority: 45,
  alias: "v1m",
  aliases: ["systemone", "jev"],
  uiAlias: "v1m",
  display: {
    name: "v1m (System One)",
    icon: "psychology",
    color: "#6366F1",
    textIcon: "V1",
    website: "https://v1m.ir",
    notice: {
      text: "v1m System One calibrated decision engine. Fast probabilistic evaluations over state and questions.",
      apiKeyUrl: "https://v1m.ir",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasProviderSpecificData: true,
  models: [
    { id: "rev-latest", name: "v1m Rev Latest (Calibrated)", kind: "systemone" },
    { id: "v1m-decision-engine", name: "v1m Decision Engine", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://v1m.ir/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
