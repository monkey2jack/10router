import { describe, expect, it } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

/**
 * 2026-10-20 models.dev 校对：第一方价与转售商价必须分开记。
 *
 * deepseek-v4-flash / -pro 同时出现在第一方 deepseek 和 bai / baidu / apinex /
 * blackbox / alitp-intl 等转售商的目录里。把第一方新价直接写进 canonical
 * MODEL_PRICING 会让所有转售商跟着涨价——所以第一方价放在
 * PROVIDER_PRICING.deepseek 覆盖，canonical 保持原值。
 */
describe("第一方价覆盖，不污染转售商", () => {
  it("deepseek 第一方用 models.dev 官方价", () => {
    expect(getPricingForModel("deepseek", "deepseek-v4-flash")).toMatchObject({ input: 0.15, output: 0.6 });
    expect(getPricingForModel("deepseek", "deepseek-v4-pro")).toMatchObject({ input: 0.66, output: 1.98 });
  });

  it("同名转售商仍走 canonical，不被第一方价带偏", () => {
    expect(getPricingForModel("bai", "deepseek-v4-flash")).toMatchObject({ input: 0.14, output: 0.28 });
    expect(getPricingForModel("baidu", "deepseek-v4-pro")).toMatchObject({ input: 0.435, output: 0.87 });
  });
});

describe("models.dev 补齐的第一方价格", () => {
  const cases = [
    ["groq", "openai/gpt-oss-120b", { input: 0.15, output: 0.6 }],
    ["mistral", "codestral-latest", { input: 0.3, output: 0.9 }],
    ["cohere", "command-r-08-2024", { input: 0.15, output: 0.6 }],
    ["morph", "morph-v3-fast", { input: 0.8, output: 1.2 }],
    ["perplexity", "sonar", { input: 1, output: 1 }],
    ["venice", "zai-org-glm-5", { input: 1, output: 3.2 }],
    ["longcat", "LongCat-2.0", { input: 0.75, output: 2.95 }],
    ["cerebras", "gpt-oss-120b", { input: 0.35, output: 0.75 }],
    ["openai", "o3", { input: 2, output: 8 }],
    ["stepfun-cn", "step-3.5-flash", { input: 0.1, output: 0.3 }],
  ];
  for (const [provider, model, expected] of cases) {
    it(`${provider}/${model}`, () => {
      expect(getPricingForModel(provider, model)).toMatchObject(expected);
    });
  }

  it("StepFun 国际站 step-5-preview 与国内站不同价", () => {
    expect(getPricingForModel("stepfun", "step-5-preview").input).toBeCloseTo(0.959, 3);
    expect(getPricingForModel("stepfun-cn", "step-5-preview").input).toBeCloseTo(1.0, 3);
  });
});

describe("kilo-auto 档位能力（此前全落 200K/64K 兜底）", () => {
  it("frontier / balanced 保留 vision，free 是纯文本", async () => {
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    expect(getCapabilitiesForModel("kilo-gateway", "kilo-auto/frontier"))
      .toMatchObject({ vision: true, contextWindow: 1000000, maxOutput: 128000 });
    expect(getCapabilitiesForModel("kilo-gateway", "kilo-auto/balanced"))
      .toMatchObject({ vision: true, contextWindow: 1000000, maxOutput: 65536 });
    expect(getCapabilitiesForModel("kilo-gateway", "kilo-auto/free"))
      .toMatchObject({ vision: false, contextWindow: 256000, maxOutput: 32768 });
  });
});
