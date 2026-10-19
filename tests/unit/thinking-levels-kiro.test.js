import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { buildKiroAdditionalModelRequestFieldsForModel } from "../../open-sse/config/kiroConstants.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// claude-adaptive 的完整档位（含 xhigh）；Opus/Sonnet 4.6 按 Anthropic/Kiro 文档无 xhigh。
const ADAPTIVE_XHIGH = ["none", "low", "medium", "high", "xhigh", "max"];
const CLAUDE_NO_XHIGH = ["none", "low", "medium", "high", "max"];

describe("getThinkingLevels for Kiro", () => {
  it("does not advertise native intensity for legacy Kiro models", () => {
    expect(getThinkingLevels("kiro", "claude-sonnet-4.5")).toBeNull();
    expect(getThinkingLevels("kiro", "glm-5")).toBeNull();
  });

  it("advertises native levels for supported Kiro models", () => {
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("high");
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("xhigh");
    expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("max");
    expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toContain("xhigh");
  });

  it("omits xhigh on 4.6 models (upstream rejects it there)", () => {
    for (const model of ["claude-opus-4.6", "claude-opus-4-6", "claude-sonnet-4.6"]) {
      expect(getThinkingLevels("kiro", model)).not.toContain("xhigh");
      expect(getThinkingLevels("kiro", model)).toContain("max");
    }
  });

  it("passes xhigh/max through on the wire for 4.7+, clamps xhigh on 4.6", () => {
    const xhigh = { output_config: { effort: "xhigh" } };
    expect(buildKiroAdditionalModelRequestFieldsForModel(xhigh, "claude-sonnet-5")?.output_config?.effort).toBe("xhigh");
    expect(buildKiroAdditionalModelRequestFieldsForModel({ output_config: { effort: "max" } }, "claude-opus-4.6")?.output_config?.effort).toBe("max");
    expect(buildKiroAdditionalModelRequestFieldsForModel(xhigh, "claude-opus-4.6")?.output_config?.effort).toBe("high");
    // Anthropic-wire path: 后缀覆盖在 4.7+ 发出真实 xhigh，4.6 钳回 high。
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-5-5(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("xhigh");
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-4.6(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("high");
  });
});

describe("getThinkingLevels for claude-adaptive", () => {
  it("exposes xhigh on adaptive models that support it", () => {
    expect(getThinkingLevels("claude", "claude-opus-5-5")).toEqual(ADAPTIVE_XHIGH);
    expect(getThinkingLevels("claude", "claude-sonnet-5")).toEqual(ADAPTIVE_XHIGH);
    expect(getThinkingLevels("claude", "claude-opus-4.7")).toEqual(ADAPTIVE_XHIGH);
    expect(getThinkingLevels("claude", "claude-fable-5-1")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps 4.6 models on the no-xhigh set", () => {
    expect(getThinkingLevels("claude", "claude-opus-4.6")).toEqual(CLAUDE_NO_XHIGH);
    expect(getThinkingLevels("claude", "claude-opus-4-6")).toEqual(CLAUDE_NO_XHIGH);
    expect(getThinkingLevels("claude", "claude-sonnet-4.6")).toEqual(CLAUDE_NO_XHIGH);
  });

  it("kimi format stays on max-tier without xhigh", () => {
    expect(getThinkingLevels("kimi", "kimi-k2.6")).toEqual(["none", "low", "medium", "high", "max"]);
  });

  it("maps xhigh→high on the wire only when the model does not advertise xhigh", () => {
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-5-5(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("xhigh");
    expect(applyThinking(FORMATS.CLAUDE, "claude-sonnet-5(max)", { messages: [] }, "claude").output_config?.effort).toBe("max");
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-4.6(xhigh)", { messages: [] }, "claude").output_config?.effort).toBe("high");
    // 低档位与 auto 映射不受影响。
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-5-5(low)", { messages: [] }, "claude").output_config?.effort).toBe("low");
    expect(applyThinking(FORMATS.CLAUDE, "claude-opus-5-5(auto)", { messages: [] }, "claude").output_config?.effort).toBe("high");
  });
});
