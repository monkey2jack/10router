// v1m（v1m.ir）— System One 决策供应商接线合同（上游 v0.5.95, 0a879c5c 的
// 思路重实现，测试形状参照上游 tests/unit/v1m-systemone-provider.test.js +
// 本仓 drex-wiring）：systemone-only 目录（无 chat transport，同 drex 先例）、
// PROVIDER_MEDIA.systemoneConfig、registry/index.js 登记、aliases
// （systemone|jev）解析，以及连接的 providerSpecificData.baseUrl 覆盖默认端点。

import { describe, expect, it, vi, afterEach } from "vitest";

import v1m from "open-sse/providers/registry/v1m.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";

describe("registry contract: v1m (System One)", () => {
  it("is an apikey, systemone-only provider with providerSpecificData support", () => {
    expect(v1m.category).toBe("apikey");
    expect(v1m.authType).toBe("apikey");
    expect(v1m.hasProviderSpecificData).toBe(true);
    expect(v1m.serviceKinds).toEqual(["systemone"]);
    expect(v1m.transport).toBeUndefined();
  });

  it("advertises the decision-model catalog, all on the systemone kind", () => {
    expect(v1m.models.map((m) => m.id)).toEqual(["rev-latest", "v1m-decision-engine"]);
    expect(v1m.models.every((m) => m.kind === "systemone")).toBe(true);
  });

  it("is registered with a systemoneConfig and resolvable model ids", () => {
    expect(REGISTRY.some((e) => e.id === "v1m")).toBe(true);
    expect(PROVIDER_MEDIA.v1m?.systemoneConfig?.baseUrl).toBe("https://v1m.ir/v1/systemone");
    expect(PROVIDER_MODELS.v1m.map((m) => m.id)).toContain("v1m-decision-engine");
  });

  it("resolves its aliases (systemone / jev) back to v1m", () => {
    expect(v1m.aliases).toEqual(["systemone", "jev"]);
    expect(resolveProviderAlias("systemone")).toBe("v1m");
    expect(resolveProviderAlias("jev")).toBe("v1m");
    expect(resolveProviderAlias("v1m")).toBe("v1m");
  });

  it("appears in getProvidersByKind('systemone')", () => {
    const found = getProvidersByKind("systemone").find((p) => p.id === "v1m");
    expect(found).toBeDefined();
    expect(found.alias).toBe("v1m");
    expect(found.systemoneConfig?.baseUrl).toBe("https://v1m.ir/v1/systemone");
    expect(AI_PROVIDERS.v1m?.hasProviderSpecificData).toBe(true);
  });

  it("opts out of the usage card (no quota API exists, 同 drex)", () => {
    expect(v1m.features?.usage).toBeFalsy();
    expect(v1m.features?.usageApikey).toBeFalsy();
  });
});

describe("systemoneCore baseUrl override (providerSpecificData.baseUrl)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = { state: { s: 1 }, questions: { q: { type: "noul" } } };

  it("falls back to the registry systemoneConfig.baseUrl by default", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ distributions: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider: "v1m", model: "rev-latest" },
      credentials: { apiKey: "sk-test" },
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://v1m.ir/v1/systemone",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("prefers credentials.providerSpecificData.baseUrl when set", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ distributions: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider: "v1m", model: "rev-latest" },
      credentials: {
        apiKey: "sk-test",
        providerSpecificData: { baseUrl: "https://gw.example.internal/v1/systemone" },
      },
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://gw.example.internal/v1/systemone",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
