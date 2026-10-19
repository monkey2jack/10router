// GPT-6 家族能力 / 官方定价 / 真实上下文窗口（上游 92c7bdd5 / dec820b9 /
// 89ffac5a 的思路重实现）：
//   1. codex 段补 gpt-6-sol / gpt-6-luna 显式行（codex 后端把窗口截到 272k，
//      与 OpenAI API 的 1.05M 不同）。
//   2. GPT-6 官方 Standard 短上下文定价（astra 10/50、sol 2/10、luna 0.10/0.50），
//      gpt-6.1-sol 与 gpt-6-sol 同档。
//   3. `*gpt-6*` pattern 换回真实的 1.05M API 窗口；gpt-5.4 起步的 1.05M 档
//      与 mini/nano 400k 例外；Devin CLI 200k 截断行 + cx/dv/devin 别名。
import { describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  PROVIDER_CAPABILITIES,
  PATTERN_CAPABILITIES,
} from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const CODEX_GPT6_CAPS = {
  vision: true,
  reasoning: true,
  search: true,
  thinkingFormat: "openai",
  contextWindow: 272000,
  maxOutput: 128000,
};

const API_WINDOW = 1050000;
const LEGACY_GPT5_WINDOW = 400000;

describe("codex GPT-6 Sol/Luna capabilities（上游 92c7bdd5）", () => {
  it.each(["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"])(
    "codex/%s 显式行为 272k 家族规格",
    (model) => {
      expect(getCapabilitiesForModel("codex", model)).toMatchObject(CODEX_GPT6_CAPS);
    },
  );

  it("codex OAuth 家族截断值不受 pattern 修正影响（Sol 372k / 其余 272k）", () => {
    expect(getCapabilitiesForModel("codex", "gpt-5.6-sol").contextWindow).toBe(372000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-luna").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna").contextWindow).toBe(272000);
  });
});

describe("GPT-6 官方定价（上游 92c7bdd5 / dec820b9）", () => {
  it("astra / sol / luna / 6.1-sol 按官方 Standard 短上下文档计价", () => {
    expect(getPricingForModel("codex", "gpt-6-astra")).toMatchObject({
      input: 10, cached: 1, cache_creation: 12.5, output: 50,
    });
    expect(getPricingForModel("codex", "gpt-6.1-sol")).toMatchObject({
      input: 2, cached: 0.1, cache_creation: 2.5, output: 10,
    });
    expect(getPricingForModel("codex", "gpt-6-sol")).toMatchObject({
      input: 2, cached: 0.2, cache_creation: 2.5, output: 10,
    });
    expect(getPricingForModel("codex", "gpt-6-luna")).toMatchObject({
      input: 0.1, cached: 0.01, cache_creation: 0.125, output: 0.5,
    });
  });
});

describe("gpt-6 / gpt-5.4+ 真实上下文窗口（上游 89ffac5a）", () => {
  const codexIds = (REGISTRY.find((p) => p.id === "codex")?.models || []).map(
    (m) => (typeof m === "string" ? m : m.id),
  );

  it("registry：codex 目录携带 gpt-6-sol / gpt-6-luna / gpt-6.1-sol", () => {
    for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6.1-sol"]) {
      expect(codexIds).toContain(id);
    }
  });

  it("普通 provider 的 gpt-6 发布真实的 1.05M API 窗口", () => {
    for (const [provider, model] of [
      ["openai", "gpt-6-astra"],
      ["github", "gpt-6-sol"],
      ["azure", "gpt-6-luna"],
    ]) {
      expect(getCapabilitiesForModel(provider, model).contextWindow, `${provider}/${model}`).toBe(API_WINDOW);
    }
  });

  // pattern 是 first-match-wins：这段实际是在钉条目顺序——把 mini/nano 例外
  // 挪到档位行后面，两个档位就会静默发布成 1.05M。
  it("1.05M 档（5.4/5.5/5.6）与 400k 档（mini/nano/旧代）分开", () => {
    for (const model of ["gpt-5.4", "gpt-5.4-pro", "gpt-5.5", "gpt-5.6", "gpt-5.6-luna", "gpt-5.6-terra"]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(API_WINDOW);
    }
    for (const model of ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5.3-codex"]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(LEGACY_GPT5_WINDOW);
    }
  });

  it("Devin CLI 的 7 个 GPT-5.4/5.5 档位钉在网关自己的 200k", () => {
    for (const model of [
      "gpt-5.4-high", "gpt-5.4-medium", "gpt-5.4-low",
      "gpt-5.5-xhigh", "gpt-5.5-high", "gpt-5.5-medium", "gpt-5.5-low",
    ]) {
      expect(getCapabilitiesForModel("devin-cli", model), model).toMatchObject({
        vision: true,
        reasoning: true,
        search: true,
        thinkingFormat: "openai",
        contextWindow: 200000,
        maxOutput: 128000,
      });
    }
  });

  it("别名 cx/dv/devin 与 provider id 命中同一张表", () => {
    expect(PROVIDER_CAPABILITIES.cx).toBe(PROVIDER_CAPABILITIES.codex);
    expect(PROVIDER_CAPABILITIES.dv).toBe(PROVIDER_CAPABILITIES["devin-cli"]);
    expect(PROVIDER_CAPABILITIES.devin).toBe(PROVIDER_CAPABILITIES["devin-cli"]);
    expect(getCapabilitiesForModel("dv", "gpt-5.5-high").contextWindow).toBe(200000);
    expect(getCapabilitiesForModel("devin", "gpt-5.5-high").contextWindow).toBe(200000);
    expect(getCapabilitiesForModel("cx", "gpt-6-sol").contextWindow).toBe(272000);
  });

  it("pattern 顺序钉形：gpt-5.4-mini/nano 例外行先于 *gpt-5.4* 档位行", () => {
    const idx = (p) => PATTERN_CAPABILITIES.findIndex((e) => e.pattern === p);
    expect(idx("*gpt-5.4-mini*")).toBeGreaterThanOrEqual(0);
    expect(idx("*gpt-5.4-nano*")).toBeGreaterThanOrEqual(0);
    expect(idx("*gpt-5.4-mini*")).toBeLessThan(idx("*gpt-5.4*"));
    expect(idx("*gpt-5.4-nano*")).toBeLessThan(idx("*gpt-5.4*"));
    expect(idx("*gpt-5.4*")).toBeLessThan(idx("*gpt-5*"));
  });
});
