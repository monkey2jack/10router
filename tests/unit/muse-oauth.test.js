import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Muse (Meta Model API) 双认证供应商：registry 契约 + Meta 账号 device code
// 流程语义点（思路对齐上游 decolua/9router 28809807，按本仓形状钉住）。
// OAuth 流程 stub 全局 fetch（形状参照 glm-oauth.test.js）。

const { mockConnection } = vi.hoisted(() => ({ mockConnection: { current: null } }));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));
vi.mock("@/models", () => ({
  getProviderConnectionById: async () => mockConnection.current,
}));

import museOauthProvider from "../../src/lib/oauth/providers/muse.js";
import { getProvider, pollForToken } from "../../src/lib/oauth/providers/index.js";
import { MUSE_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const CHAT_URL = "https://api.meta.ai/v1/chat/completions";
const MODELS_URL = "https://api.meta.ai/v1/models";

const MUSE_MODEL_IDS = [
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.1",
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("muse registry 契约（双认证）", () => {
  const entry = REGISTRY.find((e) => e.id === "muse");

  it("登记为 oauth+apikey 双模式 oauth 类供应商", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth", "apikey"]);
    expect(entry.hasOAuth).toBe(true);
    expect(entry.passthroughModels).toBe(true);
  });

  it("alias 与全量别名解析到 muse", () => {
    expect(entry.alias).toBe("muse");
    expect(entry.aliases).toEqual(["muse-ai", "meta-model-api", "muse-code", "muse-subscription"]);
  });

  it("transport 指向 api.meta.ai（auth hook + oauth 字段注入）", () => {
    expect(PROVIDERS.muse.baseUrl).toBe(CHAT_URL);
    expect(PROVIDERS.muse.validateUrl).toBe(MODELS_URL);
    expect(PROVIDERS.muse.modelsUrl).toBe(MODELS_URL);
    expect(PROVIDERS.muse.format).toBe("openai");
    expect(PROVIDERS.muse.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
    expect(PROVIDERS.muse.auth.hooks).toContain("museHeaders");
    // clientId/tokenUrl 由 oauth 块注入 transport（单一来源）
    expect(PROVIDERS.muse.clientId).toBe("1031625952748946");
    expect(PROVIDERS.muse.tokenUrl).toBe("https://auth.meta.com/oidc/device/token/");
  });

  it("双端点 transports：openai + openai-responses，各带 museHeaders", () => {
    const formats = (PROVIDERS.muse.transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "openai-responses"]);
    for (const t of PROVIDERS.muse.transports) {
      expect(t.auth.hooks).toContain("museHeaders");
    }
    expect(PROVIDERS.muse.transports[1].baseUrl).toBe("https://api.meta.ai/v1/responses");
  });

  it("模型表：5 个 Muse Spark，全部钉在 openai-responses", () => {
    const models = PROVIDER_MODELS.muse || [];
    expect(models.map((m) => m.id)).toEqual(MUSE_MODEL_IDS);
    for (const m of models) {
      expect(m.targetFormat).toBe("openai-responses");
      expect(m.supportedFormats).toEqual(["openai-responses"]);
    }
  });

  it("OAuth 端点来自 registry.oauth（无 refresh 授权）", () => {
    expect(PROVIDER_OAUTH.muse).toMatchObject({
      clientId: "1031625952748946",
      deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
      tokenUrl: "https://auth.meta.com/oidc/device/token/",
    });
    expect(PROVIDER_OAUTH.muse.refresh).toBeUndefined();
    expect(MUSE_CONFIG.clientId).toBe("1031625952748946");
    expect(getProvider("muse")).toBe(museOauthProvider);
    expect(getProvider("muse").flowType).toBe("device_code");
  });

  it("复用既有能力表与价格表（muse-spark 行在 opencode-zen 批已入表）", () => {
    expect(getCapabilitiesForModel("muse", "muse-spark-1.3")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
    expect(getPricingForModel("muse", "muse-spark-1.3")).toMatchObject({ input: 1.25, output: 4.25 });
    expect(getPricingForModel("muse", "muse-spark-1.2-contributor")).toMatchObject({ input: 0.10, output: 0.20 });
  });

  it("走共享 DefaultExecutor（无专用 adapter）", () => {
    expect(getExecutor("muse")).toBeInstanceOf(DefaultExecutor);
  });
});

describe("muse OAuth 流程（Meta device code + key 铸造）", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || "GET", init });
        const u = String(url);

        if (u === "https://auth.meta.com/oidc/device/authorization/") {
          return jsonResponse({
            device_code: "dc-123",
            user_code: "ABCD-EFGH",
            verification_uri: "https://auth.meta.com/device",
            expires_in: 300,
            interval: 5,
          });
        }
        if (u === "https://auth.meta.com/oidc/device/token/") {
          if (globalThis.__musePollError === "authorization_pending") {
            return jsonResponse({ error: "authorization_pending" }, 400);
          }
          if (globalThis.__musePollError === "slow_down") {
            return jsonResponse({ error: "slow_down" }, 400);
          }
          if (globalThis.__musePollError === "expired") {
            return jsonResponse({ error: "expired_token" }, 400);
          }
          return jsonResponse({ access_token: "meta-account-token" });
        }
        if (u === "https://api.meta.ai/muse-code/key") {
          if (globalThis.__museMintError) return globalThis.__museMintError();
          return jsonResponse({
            api_key: "LLM|1234567890|abcdef",
            user_email: "  USER@Example.COM ",
            subs_tier_name: "Muse Code Pro",
            is_subs_active: true,
          });
        }
        return jsonResponse({ error: `unexpected ${url}` }, 500);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__musePollError;
    delete globalThis.__museMintError;
  });

  it("device code 申请：表单携带 client_id，头带 x-api-version", async () => {
    const device = await museOauthProvider.requestDeviceCode(museOauthProvider.config);
    expect(device.device_code).toBe("dc-123");
    expect(device.user_code).toBe("ABCD-EFGH");
    expect(device.interval).toBe(5);

    expect(calls[0].method).toBe("POST");
    expect(calls[0].init.headers["x-api-version"]).toBe("1.0.0");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(calls[0].init.body)).toContain("client_id=1031625952748946");
  });

  it("device code 申请失败：抛出带响应体的错误", async () => {
    globalThis.__museMintError = null;
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(museOauthProvider.requestDeviceCode(museOauthProvider.config)).rejects.toThrow(
      /Muse Code device code request failed: bad request/,
    );
  });

  it("authorization_pending（即使配 4xx）映射为 ok:true 继续轮询", async () => {
    globalThis.__musePollError = "authorization_pending";
    const result = await museOauthProvider.pollToken(museOauthProvider.config, "dc-123");
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });
  });

  it("slow_down 同样按 pending 处理", async () => {
    globalThis.__musePollError = "slow_down";
    const result = await museOauthProvider.pollToken(museOauthProvider.config, "dc-123");
    expect(result.ok).toBe(true);
    expect(result.data.error).toBe("slow_down");
  });

  it("过期/拒绝按 ok:false 硬失败上抛", async () => {
    globalThis.__musePollError = "expired";
    const result = await museOauthProvider.pollToken(museOauthProvider.config, "dc-123");
    expect(result.ok).toBe(false);
    expect(result.data.error).toBe("expired_token");
  });

  it("pollToken 请求体带 device code 授权类型与 client_id", async () => {
    await museOauthProvider.pollToken(museOauthProvider.config, "dc-123");
    const poll = calls.find((c) => c.url.includes("/oidc/device/token/"));
    const body = String(poll.init.body);
    expect(body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
    expect(body).toContain("device_code=dc-123");
    expect(body).toContain("client_id=1031625952748946");
    expect(poll.init.headers["x-api-version"]).toBe("1.0.0");
  });

  it("授权成功 → postExchange 铸造订阅 key（onboard:true，携带账号 token）", async () => {
    const poll = await museOauthProvider.pollToken(museOauthProvider.config, "dc-123");
    const extra = await museOauthProvider.postExchange(poll.data);

    expect(extra.key.api_key).toBe("LLM|1234567890|abcdef");
    const mint = calls.find((c) => c.url === "https://api.meta.ai/muse-code/key");
    expect(mint.method).toBe("POST");
    expect(mint.init.headers.Authorization).toBe("Bearer meta-account-token");
    expect(mint.init.headers["x-api-version"]).toBe("1.0.0");
    expect(JSON.parse(mint.init.body)).toEqual({ onboard: true });
    // device code 一次性 + 铸造端点限流激进 → 禁用重定向（防御凭据外泄）
    expect(mint.init.redirect).toBe("error");
  });

  it("429 限流：重试后成功", async () => {
    let mintCalls = 0;
    globalThis.__museMintError = () => {
      mintCalls += 1;
      if (mintCalls === 1) return new Response("rate limited", { status: 429 });
      return jsonResponse({ api_key: "LLM|retry|ok", is_subs_active: true });
    };
    // 重试退避是真实秒级等待，测试中替身化为立即返回
    const timeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn) => { fn(); return 0; });

    const extra = await museOauthProvider.postExchange({ access_token: "meta-account-token" });
    expect(extra.key.api_key).toBe("LLM|retry|ok");
    expect(mintCalls).toBe(2);
    timeoutSpy.mockRestore();
  });

  it("铸造失败（403 错误信封）：错误信息带修复入口 URL", async () => {
    globalThis.__museMintError = () =>
      jsonResponse({ title: "Not eligible", detail: "Join the waitlist first", action_url: "https://muse.ai/waitlist" }, 403);
    await expect(museOauthProvider.postExchange({ access_token: "t" })).rejects.toThrow(
      /Muse Code key mint failed: Not eligible: Join the waitlist first — https:\/\/muse.ai\/waitlist/,
    );
  });

  it("订阅未激活：明确报错提示先激活订阅", async () => {
    globalThis.__museMintError = () => jsonResponse({ is_subs_active: false });
    await expect(museOauthProvider.postExchange({ access_token: "t" })).rejects.toThrow(
      /subscription is inactive/,
    );
  });

  it("缺 key 且要求付费：提示订阅入口 URL", async () => {
    globalThis.__museMintError = () =>
      jsonResponse({ require_payment: true, require_payment_action_url: "https://muse.ai/pay" });
    await expect(museOauthProvider.postExchange({ access_token: "t" })).rejects.toThrow(
      /Muse Code subscription required: https:\/\/muse.ai\/pay/,
    );
  });

  it("缺 key 且无进一步线索：兜底报错", async () => {
    globalThis.__museMintError = () => jsonResponse({ is_subs_active: true });
    await expect(museOauthProvider.postExchange({ access_token: "t" })).rejects.toThrow(
      /missing api_key/,
    );
  });

  it("mapTokens：accessToken 是铸造的 key，email 归一化，无 refresh/过期", () => {
    const tokens = museOauthProvider.mapTokens(
      { access_token: "meta-account-token" },
      {
        key: {
          api_key: "LLM|1234567890|abcdef",
          user_email: "  USER@Example.COM ",
          subs_tier_name: "Muse Code Pro",
        },
      },
    );
    expect(tokens.accessToken).toBe("LLM|1234567890|abcdef");
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.expiresIn).toBeNull();
    expect(tokens.email).toBe("user@example.com");
    expect(tokens.providerSpecificData).toEqual({
      authMethod: "device_code",
      oauthAccessToken: "meta-account-token",
      subscriptionTier: "Muse Code Pro",
    });
  });

  it("pollForToken 集成：store 铸造 key 而非账号 token", async () => {
    const result = await pollForToken("muse", "dc-123", null, null);
    expect(result.success).toBe(true);
    expect(result.tokens.accessToken).toBe("LLM|1234567890|abcdef");
    expect(result.tokens.refreshToken).toBeNull();
  });

  it("pollForToken 集成：key 铸造失败按 fatal 返回（一次性 device code 不可恢复）", async () => {
    globalThis.__museMintError = () => jsonResponse({ is_subs_active: false });
    const result = await pollForToken("muse", "dc-123", null, null);
    expect(result.success).toBe(false);
    expect(result.error).toBe("exchange_failed");
    expect(result.errorDescription).toMatch(/subscription is inactive/);
    expect(result.fatal).toBe(true);
  });
});

describe("muse executor + 模型目录", () => {
  it("OAuth（铸造 key 在 accessToken 上）请求带 x-api-version", () => {
    const executor = new DefaultExecutor("muse");
    const headers = executor.buildHeaders(
      { accessToken: "LLM|abc|def", refreshToken: null },
      true,
      CHAT_URL,
      "muse-spark-1.3",
      {},
    );
    expect(headers.Authorization).toBe("Bearer LLM|abc|def");
    expect(headers["x-api-version"]).toBe("1.0.0");
  });

  it("粘贴 API key 的连接不带 x-api-version", () => {
    const executor = new DefaultExecutor("muse");
    const headers = executor.buildHeaders(
      { apiKey: "LLM|abc|def", accessToken: null },
      false,
      CHAT_URL,
      "muse-spark-1.3",
      {},
    );
    expect(headers.Authorization).toBe("Bearer LLM|abc|def");
    expect(headers["x-api-version"]).toBeUndefined();
  });

  it("模型目录解析：OpenAI data 数组形状 + 固定 x-api-version 头", async () => {
    mockConnection.current = { id: "conn-1", provider: "muse", apiKey: "LLM|abc|def" };
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: "muse-spark-1.3" }, { id: "muse-spark-1.2-contributor" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
      const res = await GET(new Request("http://localhost/api/providers/conn-1/models"), {
        params: Promise.resolve({ id: "conn-1" }),
      });
      const body = await res.json();
      expect(body.models).toEqual([{ id: "muse-spark-1.3" }, { id: "muse-spark-1.2-contributor" }]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(MODELS_URL);
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer LLM|abc|def");
      expect(init.headers["x-api-version"]).toBe("1.0.0");
    } finally {
      vi.unstubAllGlobals();
      mockConnection.current = null;
    }
  });
});
