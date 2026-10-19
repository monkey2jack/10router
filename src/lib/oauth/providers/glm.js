import crypto from "crypto";
import { GLM_OAUTH_CONFIG } from "../constants/oauth.js";

// Zai GLM Coding OAuth — ZCode CLI 轮询流程（对齐上游 decolua/9router 068ce87d
// 的协议，按本仓 providers 形状重写；协议参考官方 ZCode CLI 的 cli-oauth）。
// 非 PKCE、无本地回调服务器：
//
//   1) POST {cliInitUrl}   Authorization: Bearer <pollToken>  {"provider":"zai"}
//        → { code: 0, data: { authorize_url, flow_id, poll_interval_sec, expires_at } }
//   2) 浏览器打开 authorize_url，用户用 Z.ai 账号登录
//   3) GET {cliPollUrl}/<flow_id>   Authorization: Bearer <pollToken>
//        → { data: { status: "pending" } } 轮询直到
//          { data: { status: "ready", token, user, zai: { access_token, refresh_token? } } }
//   4) Z.AI OAuth token → POST {businessLoginUrl} {"token": ...}
//        → { data: { access_token } }（平台业务 JWT）
//   5) 业务 JWT → coding-plan API key：getCustomerInfo → api_keys
//      list/create("zcode-api-key") → copy → "{apiKey}.{secretKey}"
//
// coding-plan API key 才是长期模型凭证；Z.AI OAuth 无 refresh 授权，过期须重新
// 登录（与官方 CLI 一致）。zcode JWT 与业务 token 一并存入 providerSpecificData
// 供配额查询/调试使用。
const glm = {
  config: GLM_OAUTH_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    // 本地随机 poll token：作为整条 CLI 流程的会话凭证
    const zcodePollToken = crypto.randomBytes(32).toString("hex");
    const response = await fetch(config.cliInitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${zcodePollToken}`,
      },
      body: JSON.stringify({ provider: config.providerId || "zai" }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Zai OAuth init failed: ${error}`);
    }
    const payload = await response.json();
    if (!isSuccessCode(payload.code) || !payload.data) {
      throw new Error(payload.msg || "Zai OAuth init returned no data");
    }
    const data = payload.data;
    if (!data.flow_id || !data.authorize_url) {
      throw new Error("Zai OAuth init response missing flow_id/authorize_url");
    }
    return {
      device_code: data.flow_id,
      verification_uri: data.authorize_url,
      // expires_at 是上游绝对时间戳；换算为相对秒数供 UI 倒计时
      expires_in: relativeSeconds(data.expires_at) ?? 300,
      interval: data.poll_interval_sec || 3,
      _zcodePollToken: zcodePollToken,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData) => {
    const zcodePollToken = extraData?._zcodePollToken;
    if (!zcodePollToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Missing Zai poll token — restart the login flow",
        },
      };
    }

    const response = await fetch(`${config.cliPollUrl}/${encodeURIComponent(deviceCode)}`, {
      headers: { Authorization: `Bearer ${zcodePollToken}` },
    });
    if (!response.ok) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: `Zai poll failed (HTTP ${response.status})`,
        },
      };
    }
    const payload = await response.json();
    if (!isSuccessCode(payload.code)) {
      return {
        ok: true,
        data: { error: "access_denied", error_description: payload.msg || "Zai poll failed" },
      };
    }

    const data = payload.data || {};
    if (data.status === "pending") {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (data.status === "failed") {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Zai authorization failed or was cancelled",
        },
      };
    }
    if (data.status !== "ready") {
      return {
        ok: true,
        data: { error: "authorization_pending", error_description: `Unknown status: ${data.status}` },
      };
    }

    // ready 载荷把 ZAI OAuth token 嵌在 data[providerId] 下：
    // { status:"ready", token, user, zai: { access_token, refresh_token? } }。
    // 顶层字段兜底以抵御载荷漂移。
    const providerData = data[config.providerId] || data[data.providerId] || {};
    const zaiAccessToken =
      providerData.access_token ||
      providerData.accessToken ||
      data.accessToken ||
      data.access_token;
    if (!zaiAccessToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Zai poll response missing access token",
        },
      };
    }

    // ready 阶段的 Z.AI OAuth token → 推导 coding-plan API key
    const { planApiKey, businessToken } = await resolveCodingPlanApiKey(config, zaiAccessToken);

    return {
      ok: true,
      data: {
        access_token: planApiKey,
        _zcodeJwtToken: data.token || "",
        _zaiBusinessToken: businessToken,
        _zaiRefreshToken:
          providerData.refresh_token || providerData.refreshToken || data.refresh_token || data.refreshToken || "",
        _zcodeUser: data.user || {},
      },
    };
  },
  mapTokens: (tokens) => {
    const user = tokens._zcodeUser || {};
    const displayName = user.name || user.email || null;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      email: user.email || null,
      ...(displayName ? { displayName } : {}),
      providerSpecificData: {
        authMethod: "cli_poll",
        username: user.name || undefined,
        userId: user.user_id || undefined,
        zcodeJwtToken: tokens._zcodeJwtToken || undefined,
        zaiBusinessToken: tokens._zaiBusinessToken || undefined,
        ...(tokens._zaiRefreshToken ? { zaiRefreshToken: tokens._zaiRefreshToken } : {}),
      },
    };
  },
};

// 业务 JWT → coding-plan API key（"{apiKey}.{secretKey}"）：
// getCustomerInfo → 默认机构/项目 → api_keys list/create → copy → secretKey。
async function resolveCodingPlanApiKey(config, zaiAccessToken) {
  const businessToken = await exchangeBusinessToken(config, zaiAccessToken);
  const authHeaders = {
    Authorization: `Bearer ${businessToken}`,
    "Content-Type": "application/json",
  };

  const customerInfo = await fetchZaiBusinessJson(
    `${config.apiBaseUrl}/api/biz/customer/getCustomerInfo`,
    { headers: authHeaders },
    "customer info"
  );
  const location = pickOrgAndProject(customerInfo);
  if (!location) {
    throw new Error("Unable to resolve Z.ai organization and project for the coding plan");
  }

  const listUrl =
    `${config.apiBaseUrl}/api/biz/v1/organization/${location.organizationId}` +
    `/projects/${location.projectId}/api_keys`;
  const keys = (await fetchZaiBusinessJson(listUrl, { headers: authHeaders }, "api keys")) || [];
  let keyEntry = Array.isArray(keys)
    ? keys.find((item) => item?.name === config.planApiKeyName)
    : null;
  if (!keyEntry) {
    keyEntry = await fetchZaiBusinessJson(
      listUrl,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: config.planApiKeyName }),
      },
      "api key create"
    );
  }

  const apiKey = keyEntry?.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Z.ai api_keys response is missing apiKey");
  }

  const secret = await fetchZaiBusinessJson(
    `${listUrl}/copy/${encodeURIComponent(apiKey)}`,
    { headers: authHeaders },
    "api key copy"
  );
  const secretKey = secret?.secretKey?.trim();
  if (!secretKey) {
    throw new Error("Z.ai api key copy response is missing secretKey");
  }

  return { planApiKey: `${apiKey}.${secretKey}`, businessToken };
}

// POST {businessLoginUrl} {"token": <zai oauth token>} → { data: { access_token } }
async function exchangeBusinessToken(config, zaiAccessToken) {
  const payload = await fetchZaiBusinessJson(
    config.businessLoginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: zaiAccessToken }),
    },
    "Z.ai business login"
  );
  const token = payload?.access_token?.trim() || payload?.accessToken?.trim();
  if (!token) {
    throw new Error("Z.ai business login response is missing access_token");
  }
  return token;
}

// 业务端点统一应答 {code, msg, data}；code 为 0/200（或缺省）视为成功。
// 返回 data（缺省时为 null）。
async function fetchZaiBusinessJson(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Z.ai ${label} request failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Z.ai ${label} response is not valid JSON`);
  }
  if (!isSuccessCode(payload?.code) || payload?.success === false) {
    throw new Error(payload?.msg || `Z.ai ${label} returned business error ${payload?.code}`);
  }
  return payload?.data ?? payload ?? null;
}

// 优先选名为「默认机构/默认项目」(default) 的机构与非团队项目
// （projectType "2" = 团队），否则回退首项。
function pickOrgAndProject(customerInfo) {
  const organizations = Array.isArray(customerInfo?.organizations)
    ? customerInfo.organizations
    : [];
  const personalOrgs = organizations
    .map((organization) => ({
      organization,
      projects: (organization?.projects || []).filter(
        (project) => String(project?.projectType ?? "").trim() !== "2"
      ),
    }))
    .filter(({ organization, projects }) =>
      Boolean(organization?.organizationId && projects.length)
    );
  if (!personalOrgs.length) return null;

  const org =
    personalOrgs.find(({ organization }) => isDefaultName(organization.organizationName)) ||
    personalOrgs[0];
  const project =
    org.projects.find((item) => isDefaultName(item?.projectName)) || org.projects[0];
  if (!org.organization?.organizationId || !project?.projectId) return null;
  return { organizationId: org.organization.organizationId, projectId: project.projectId };
}

function isDefaultName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized.includes("默认机构") || normalized.includes("默认项目") || normalized === "default";
}

function isSuccessCode(code) {
  return code === undefined || code === null || code === 0 || code === 200 || code === "0" || code === "200";
}

// 绝对时间戳（秒或毫秒）→ 距现在的秒数；缺失/非法返回 null。
function relativeSeconds(expiresAt) {
  const raw = Number(expiresAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const seconds = Math.floor((ms - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

export default glm;
