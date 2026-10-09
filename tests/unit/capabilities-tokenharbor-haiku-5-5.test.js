import { describe, expect, it } from "vitest";

import { aggregateComboCapabilities, getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// tokenharbor 的 Haiku 5.5 使用点号 id(claude-haiku-5.5:free)。全局修复键是
// claude-haiku-5-5(连字符),不会命中点号写法,会落进 *claude*haiku* 兜底
// (200K / claude-budget)。结果是单成员 combo 的 ctx 被压成 200K。
describe("tokenharbor claude-haiku-5.5:free capabilities", () => {
  it("resolves to the 1M / 128000 adaptive first-party spec", () => {
    const caps = getCapabilitiesForModel("tokenharbor", "claude-haiku-5.5:free");
    expect(caps.contextWindow).toBe(1_000_000);
    expect(caps.maxOutput).toBe(128_000);
    expect(caps.thinkingFormat).toBe("claude-adaptive");
  });

  it("keeps a single-member combo at 1M context", () => {
    const caps = aggregateComboCapabilities(["tokenharbor/claude-haiku-5.5:free"]);
    expect(caps.contextWindow).toBe(1_000_000);
  });

  it("does not change other haiku models", () => {
    expect(getCapabilitiesForModel("claude", "claude-haiku-4-5-20251001").contextWindow).toBe(200_000);
  });
});
