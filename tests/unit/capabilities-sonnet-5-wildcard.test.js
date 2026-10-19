// 上游 ccd0677d 的通配扩展（思路重实现）：`*claude*sonnet-5*` 必须先于泛化的
// `*claude*sonnet*` 命中——未知 Sonnet 5.x id（如 5.5）落回 claude-budget 时，
// 翻译层会为 tool_use 轮伪造带签名 thinking 占位，Sonnet 5.x 只认 adaptive thinking。
import { describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  MODEL_CAPABILITIES,
  PATTERN_CAPABILITIES,
} from "../../open-sse/providers/capabilities.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const sonnet5Expected = {
  thinkingFormat: "claude-adaptive",
  contextWindow: 1000000,
  maxOutput: 128000,
  reasoning: true,
  vision: true,
  search: true,
};

describe("Claude Sonnet 5.x 通配 capabilities", () => {
  it("未知 5.x id（点/横杠/带前缀形态）解析为 adaptive + 1M", () => {
    for (const model of ["claude-sonnet-5-5", "claude-sonnet-5.5", "anthropic/claude-sonnet-5-5"]) {
      expect(getCapabilitiesForModel("claude", model)).toMatchObject(sonnet5Expected);
    }
  });

  it("精确键优先于通配：claude-sonnet-5 仍在 MODEL_CAPABILITIES 显式列出", () => {
    expect(MODEL_CAPABILITIES["claude-sonnet-5"]).toMatchObject(sonnet5Expected);
    expect(getCapabilitiesForModel("claude", "claude-sonnet-5")).toMatchObject(sonnet5Expected);
  });

  it("claude-sonnet-5-5 注册到 claude registry 且 capabilities 精确键同步", () => {
    const claude = REGISTRY.find((p) => p.id === "claude");
    const ids = (claude?.models || []).map((m) => (typeof m === "string" ? m : m.id));
    expect(ids).toContain("claude-sonnet-5-5");
    expect(MODEL_CAPABILITIES["claude-sonnet-5-5"]).toMatchObject(sonnet5Expected);
    expect(getCapabilitiesForModel("claude", "claude-sonnet-5-5")).toMatchObject(sonnet5Expected);
  });

  it("pattern 顺序钉形：sonnet-5 通配先于泛化 sonnet 兜底", () => {
    const sonnet5Idx = PATTERN_CAPABILITIES.findIndex((p) => p.pattern === "*claude*sonnet-5*");
    const genericIdx = PATTERN_CAPABILITIES.findIndex((p) => p.pattern === "*claude*sonnet*");
    expect(sonnet5Idx).toBeGreaterThanOrEqual(0);
    expect(genericIdx).toBeGreaterThanOrEqual(0);
    expect(sonnet5Idx).toBeLessThan(genericIdx);
  });

  it("老 Sonnet 系不受影响：4.5 仍落 claude-budget", () => {
    expect(getCapabilitiesForModel("claude", "claude-sonnet-4-5-20250929").thinkingFormat).toBe("claude-budget");
  });
});
