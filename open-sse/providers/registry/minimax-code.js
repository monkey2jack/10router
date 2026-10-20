export default {
  id: "minimax-code",
  priority: 82,
  alias: "mcode",
  aliases: ["mm", "mcode"],
  uiAlias: "mcode",
  display: {
    name: "MiniMax Code",
    icon: "smart_toy",
    color: "#FF4D4F",
    textIcon: "MM",
    website: "https://agent.minimax.cn",
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  features: { usage: true },
  transport: {
    baseUrl: "https://agent.minimax.cn/mavis/api/v1/llm/v1/messages",
    format: "claude",
    thinkingFormat: "claude-adaptive",
    headers: {
      "User-Agent": "MiniMaxAgent",
      "X-Mavis-Agent-Id": "main",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      anthropicVersion: true,
    },
  },
  oauth: {
    clientId: "mcode-public",
    deviceUrl: "https://account.minimax.cn/oauth2/device/code",
    tokenUrl: "https://account.minimax.cn/oauth2/token",
    scope: "agent.default",
    audience: "agent-backend",
    refreshLeadMs: 10 * 60 * 1000,
  },
  models: [
    // 正式 id（2026-10）优先；-Preview 保留一个 minor 周期，避免存量连接 /
    // disabledModels / modelCaps 里写过旧 id 的用户突然 404（issue #70）。
    { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash" },
    { id: "MiniMax-M3.1-Flash-Preview", name: "MiniMax M3.1 Flash (Preview)" },
    { id: "MiniMax-M3", name: "MiniMax M3" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
  ],
};
