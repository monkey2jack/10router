import { MUSE_CONFIG } from "../constants/oauth.js";

// Muse Code 订阅 —— Meta 账号 device code 流程打到 auth.meta.com，随后铸造聊天
// 传输实际使用的 Model API key（LLM|… 前缀）。思路对齐上游 decolua/9router
// 28809807，按本仓 providers 骨架重写。
const MUSE_KEY_URL = "https://api.meta.ai/muse-code/key";
const API_VERSION = "1.0.0";

const muse = {
  config: MUSE_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-api-version": API_VERSION,
      },
      body: new URLSearchParams({ client_id: config.clientId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Muse Code device code request failed: ${error}`);
    }

    return await response.json();
  },
  pollToken: async (config, deviceCode) => {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-api-version": API_VERSION,
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      data = { error: "invalid_response", error_description: text };
    }

    // Meta 在等待态/降速态也可能配 4xx 状态码，这两类错误码按 ok:true 上抛，
    // 由 pollForToken 映射为 pending 继续轮询。
    const pending =
      data?.error === "authorization_pending" ||
      data?.error === "slow_down";
    return { ok: response.ok || pending, data };
  },
  postExchange: async (tokens) => {
    // 铸造订阅 API key；onboard:true 让首次登录的账号完成开户。该端点限流
    // 激进（429）且 device code 一次性，这里对瞬时失败重试而不是直接判登录
    // 失败（providers/index.js 会把抛出的错误按 fatal 返回，客户端停止轮询）。
    let response;
    for (let attempt = 0; ; attempt++) {
      response = await fetch(MUSE_KEY_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
          "x-api-version": API_VERSION,
        },
        body: JSON.stringify({ onboard: true }),
        redirect: "error",
      });
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }

    const text = await response.text();
    if (!response.ok) {
      // Meta 的错误信封（例如 403 code 4705002）附带修复入口 URL，拼进错误信息
      let msg = `${response.status} ${text.slice(0, 200)}`;
      try {
        const err = JSON.parse(text);
        if (err?.title || err?.detail) {
          msg = [err.title, err.detail].filter(Boolean).join(": ");
          if (err.action_url) msg += ` — ${err.action_url}`;
        }
      } catch { /* 非 JSON 错误体 */ }
      throw new Error(`Muse Code key mint failed: ${msg}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Muse Code key mint returned invalid JSON");
    }

    if (payload.is_subs_active === false) {
      throw new Error("Muse Code subscription is inactive — activate it on muse.ai first");
    }
    const actionUrl = payload.action_url || payload.require_payment_action_url;
    if (!payload.api_key && (payload.require_payment || actionUrl)) {
      throw new Error(`Muse Code subscription required${actionUrl ? `: ${actionUrl}` : ""}`);
    }
    if (!payload.api_key) {
      throw new Error("Muse Code key response is missing api_key");
    }

    return { key: payload };
  },
  mapTokens: (tokens, extra) => {
    const payload = extra?.key || {};
    // 聊天请求携带铸造的 Model API key，不是 Meta 账号 token。
    // Meta 不给过期时间/refresh——key 失效只能重新登录。
    return {
      accessToken: payload.api_key,
      refreshToken: null,
      expiresIn: null,
      email: payload.user_email?.trim().toLowerCase() || undefined,
      providerSpecificData: {
        authMethod: "device_code",
        // 留存账号 token，将来免再次 device 登录即可重铸 key
        oauthAccessToken: tokens.access_token,
        subscriptionTier: payload.subs_tier_name || null,
      },
    };
  },
};

export default muse;
