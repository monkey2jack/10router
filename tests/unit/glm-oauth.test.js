import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// usage 测试走 proxyFetch mock（同 kimi-usage.test.js）；OAuth 流程 stub 全局 fetch
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import glmOauthProvider from "../../src/lib/oauth/providers/glm.js";
import { getProvider } from "../../src/lib/oauth/providers/index.js";
import { GLM_OAUTH_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const ANTHROPIC_URL = "https://api.z.ai/api/anthropic/v1/messages";
const PLAN_KEY = "key123.secret456";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("glm registry entry（双认证）", () => {
  it("声明 oauth+apikey 双模式且开启配额查询", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("glm");
    expect(USAGE_APIKEY_PROVIDERS).toContain("glm");
    expect(PROVIDER_OAUTH.glm).toBeDefined();
  });

  it("保留直连 api.z.ai 的 anthropic 传输（无独立网关）", () => {
    expect(PROVIDERS.glm.baseUrl).toBe(ANTHROPIC_URL);
    expect(PROVIDERS.glm.auth.header).toBe("x-api-key");
    expect(PROVIDERS.zcode).toBeUndefined();
  });

  it("声明 ZCode CLI 轮询 OAuth 端点（无 refresh 授权）", () => {
    expect(PROVIDER_OAUTH.glm.cliInitUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/init");
    expect(PROVIDER_OAUTH.glm.cliPollUrl).toBe("https://zcode.z.ai/api/v1/oauth/cli/poll");
    expect(PROVIDER_OAUTH.glm.businessLoginUrl).toBe("https://api.z.ai/api/auth/z/login");
    expect(PROVIDER_OAUTH.glm.refresh).toBeUndefined();
    expect(GLM_OAUTH_CONFIG.providerId).toBe("zai");
  });

  it("已接入通用 OAuth provider 注册表", () => {
    expect(getProvider("glm")).toBe(glmOauthProvider);
    expect(getProvider("glm").flowType).toBe("device_code");
  });

  it("glm-cn 不作 OAuth（Z.ai OAuth 仅国际站，CN 站不同源）", () => {
    expect(PROVIDER_OAUTH["glm-cn"]).toBeUndefined();
  });
});

describe("glm OAuth 流程（ZCode CLI 轮询协议）", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        const entry = { url: String(url), method: init.method || "GET", init };
        calls.push(entry);
        const u = new URL(url);

        if (u.href === "https://zcode.z.ai/api/v1/oauth/cli/init") {
          return jsonResponse({
            code: 0,
            data: {
              authorize_url: "https://chat.z.ai/api/oauth/authorize?x=1",
              flow_id: "flow-123",
              poll_interval_sec: 2,
              expires_at: Math.floor(Date.now() / 1000) + 300,
            },
          });
        }
        if (u.pathname.startsWith("/api/v1/oauth/cli/poll/")) {
          if (globalThis.__glmPollState === "pending") {
            return jsonResponse({ code: 0, data: { status: "pending" } });
          }
          if (globalThis.__glmPollState === "failed") {
            return jsonResponse({ code: 0, data: { status: "failed" } });
          }
          return jsonResponse({
            code: 0,
            data: {
              status: "ready",
              token: "zcode-jwt",
              providerId: "zai",
              user: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
              zai: { access_token: "zai-oauth-token", refresh_token: "zai-refresh-token" },
            },
          });
        }
        if (u.href === "https://api.z.ai/api/auth/z/login") {
          return jsonResponse({ code: 200, data: { access_token: "zai-business-jwt" } });
        }
        if (u.href === "https://api.z.ai/api/biz/customer/getCustomerInfo") {
          return jsonResponse({
            code: 200,
            data: {
              organizations: [
                {
                  organizationId: "org-1",
                  organizationName: "默认机构",
                  projects: [{ projectId: "p-1", projectName: "默认项目", projectType: "1" }],
                },
              ],
            },
          });
        }
        // api_keys：先 GET（列表为空→触发创建），后 POST（创建）
        if (u.pathname.endsWith("/api_keys") && entry.method === "GET") {
          return jsonResponse({ code: 200, data: [] });
        }
        if (u.pathname.endsWith("/api_keys")) {
          return jsonResponse({ code: 200, data: { apiKey: "key123", name: "zcode-api-key" } });
        }
        if (u.pathname.endsWith("/copy/key123")) {
          return jsonResponse({ code: 200, data: { secretKey: "secret456" } });
        }
        return jsonResponse({ code: 500, msg: `unexpected ${url}` }, 500);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.__glmPollState;
  });

  it("init 返回服务端生成的 authorize URL + flow id", async () => {
    const device = await glmOauthProvider.requestDeviceCode(glmOauthProvider.config);
    expect(device.device_code).toBe("flow-123");
    expect(device.verification_uri).toBe("https://chat.z.ai/api/oauth/authorize?x=1");
    expect(device._zcodePollToken).toEqual(expect.any(String));
    expect(device.interval).toBe(2);
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(calls[0].init.body)).toEqual({ provider: "zai" });
  });

  it("pending 轮询态映射为 authorization_pending", async () => {
    globalThis.__glmPollState = "pending";
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });
    expect(result).toEqual({ ok: true, data: { error: "authorization_pending" } });
  });

  it("failed 轮询态映射为 access_denied（用户取消）", async () => {
    globalThis.__glmPollState = "failed";
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });
    expect(result.data.error).toBe("access_denied");
  });

  it("ready 态推导 coding-plan API key（业务 JWT → api_keys 链）", async () => {
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {
      _zcodePollToken: "t",
    });

    expect(result.ok).toBe(true);
    expect(result.data.access_token).toBe(PLAN_KEY);
    expect(result.data._zcodeJwtToken).toBe("zcode-jwt");
    expect(result.data._zaiBusinessToken).toBe("zai-business-jwt");

    // 推导链：业务登录 → customer info → api_keys create → copy
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("https://api.z.ai/api/auth/z/login");
    expect(urls).toContain("https://api.z.ai/api/biz/customer/getCustomerInfo");
    expect(urls).toContain("https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys");
    expect(urls).toContain(
      "https://api.z.ai/api/biz/v1/organization/org-1/projects/p-1/api_keys/copy/key123",
    );
  });

  it("mapTokens 存档 plan key + 账号身份（无 refresh token）", () => {
    const tokens = glmOauthProvider.mapTokens({
      access_token: PLAN_KEY,
      _zcodeJwtToken: "zcode-jwt",
      _zaiBusinessToken: "zai-business-jwt",
      _zaiRefreshToken: "zai-refresh-token",
      _zcodeUser: { user_id: "u-1", name: "Feavy", email: "feavy@example.com" },
    });

    expect(tokens.accessToken).toBe(PLAN_KEY);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.email).toBe("feavy@example.com");
    expect(tokens.displayName).toBe("Feavy");
    expect(tokens.providerSpecificData).toMatchObject({
      authMethod: "cli_poll",
      username: "Feavy",
      userId: "u-1",
      zcodeJwtToken: "zcode-jwt",
      zaiBusinessToken: "zai-business-jwt",
      zaiRefreshToken: "zai-refresh-token",
    });
  });

  it("缺失 poll token 时干净失败（需重开登录流程）", async () => {
    const result = await glmOauthProvider.pollToken(glmOauthProvider.config, "flow-123", null, {});
    expect(result.data.error).toBe("access_denied");
  });
});

describe("glm executor + usage（双认证凭证）", () => {
  it("plan key 以 x-api-key 发送（无网关 hook）", () => {
    const executor = new DefaultExecutor("glm");
    const creds = { accessToken: PLAN_KEY, refreshToken: null };

    const headers = executor.buildHeaders(creds, true, ANTHROPIC_URL, "glm-5.3", {});
    expect(headers["x-api-key"]).toBe(PLAN_KEY);
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("从不调度 token 刷新（上游无 refresh 授权）", async () => {
    const executor = new DefaultExecutor("glm");
    const result = await executor.refreshCredentials(
      { accessToken: PLAN_KEY, refreshToken: null },
      console,
    );
    expect(result).toBeNull();
  });

  it("用 OAuth 签发的 key（存在 accessToken 上）拉配额", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          level: "PRO",
          limits: [
            { type: "TOKENS_LIMIT", percentage: 35.5, number: 5, unit: 3, nextResetTime: Date.now() + 3600_000 },
            { type: "CREDIT_LIMIT", percentage: 10, number: 2, unit: 6, nextResetTime: Date.now() + 7 * 86400_000 },
          ],
        },
      }),
    );

    const usage = await getUsageForProvider(
      { provider: "glm", accessToken: PLAN_KEY, apiKey: null, providerSpecificData: {} },
      null,
    );
    expect(usage.plan).toBe("Pro");
    expect(usage.quotas["Session (5h)"].used).toBe(35.5);
    expect(usage.quotas["Weekly (7d)"].used).toBe(10);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.z.ai/api/monitor/usage/quota/limit",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${PLAN_KEY}` }) }),
      null,
    );
  });

  it("粘贴 apikey 的连接仍能拉配额（保底兜底）", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ data: { level: "PRO", limits: [] } }),
    );

    const usage = await getUsageForProvider(
      { provider: "glm", accessToken: null, apiKey: PLAN_KEY, providerSpecificData: {} },
      null,
    );
    expect(usage.plan).toBe("Pro");
  });
});
