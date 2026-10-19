import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { getPricingForModel } from "../../src/shared/constants/pricing.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * River AI 供应商注册（2026-10 联调）：apikey 按量计费 + OpenAI 兼容双端点。
 * 事实源：docs.river.ai/guides/inference(-models) + /v1/models 实测——模型 id 是
 * 命名空间全名（org/Model），上下文/输出上限与官方价目表一致，钉死防漂移。
 */
describe("river provider registration", () => {
  const river = REGISTRY.find((p) => p.id === "river");

  it("is registered as an apikey provider with dual OpenAI-compatible endpoints", () => {
    expect(river).toBeTruthy();
    expect(river.category).toBe("apikey");
    expect(river.transport.baseUrl).toBe("https://api.river.ai/v1/chat/completions");
    expect(river.transport.validateUrl).toBe("https://api.river.ai/v1/models");
    const formats = (river.transports || []).map((t) => t.format).sort();
    expect(formats).toEqual(["openai", "responses"]);
    for (const t of river.transports) {
      expect(t.baseUrl).toMatch(/^https:\/\/api\.river\.ai\/v1\//);
      expect(t.auth.scheme).toBe("bearer");
    }
  });

  it("publishes the /v1/models catalog with official context/output ceilings", () => {
    const byId = Object.fromEntries((river.models || []).map((m) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual(["deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.3-Flash"]);
    expect(byId["deepseek-ai/DeepSeek-V4.1-Flash"]).toMatchObject({ contextWindow: 1048576, maxOutput: 384000 });
    expect(byId["zai-org/GLM-5.3-Flash"]).toMatchObject({ contextWindow: 1048576, maxOutput: 131072 });
  });

  it("resolves rv / river spellings and carries official USD pricing", () => {
    expect(resolveProviderAlias("river")).toBe("river");
    expect(resolveProviderAlias("rv")).toBe("river");
    // docs.river.ai/guides/inference-models：USD per 1M tokens，推理按输出计费
    expect(getPricingForModel("river", "deepseek-ai/DeepSeek-V4.1-Flash")).toMatchObject({
      input: 0.12, output: 0.48, cached: 0.0024,
    });
    expect(getPricingForModel("river", "zai-org/GLM-5.3-Flash")).toMatchObject({
      input: 0.12, output: 0.40, cached: 0.024,
    });
  });

  it("ships the 128×128 RGBA brand tile", () => {
    const icon = path.join(root, "public", "providers", "river.png");
    expect(fs.existsSync(icon)).toBe(true);
    const buf = fs.readFileSync(icon);
    expect(buf.readUInt32BE(16)).toBe(128);
    expect(buf[25]).toBe(6);
  });
});
