// Sonnet 5.5 的 API 对 thinking.type "disabled" 和强制 tool_choice（any/tool）直接
// 400：缺这层归一化，关 thinking 或 forced tool_choice 就炸。这里只钉翻译器半边
// （上游 49ba54b2 的 translator/formats/claude.js 部分）；假想 id `claude-sonnet-5-5`
// 的能力行用 mock 注入——注册表/capabilities 半边由并行任务负责。
import { describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/providers/capabilities.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCapabilitiesForModel: (provider, model) =>
      model === "claude-sonnet-5-5"
        ? { ...actual.getCapabilitiesForModel(provider, "claude-sonnet-5"), thinkingOffType: "between_tools", forcedToolChoice: false }
        : actual.getCapabilitiesForModel(provider, model),
  };
});

const { prepareClaudeRequest } = await import("../../open-sse/translator/formats/claude.js");
const { translateRequest } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

describe("Claude Sonnet 5.5 request shape (translator half)", () => {
  const prepare = (body) => prepareClaudeRequest({ max_tokens: 1024, messages: [{ role: "user", content: "hi" }], ...body }, "claude");

  it("turns thinking off with between_tools, clamping effort to high", () => {
    const body = prepare({ model: "claude-sonnet-5-5", thinking: { type: "disabled" }, output_config: { effort: "max" } });
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.output_config.effort).toBe("high");
  });

  it("clamps xhigh effort too, but leaves low effort alone", () => {
    const xhigh = prepare({ model: "claude-sonnet-5-5", thinking: { type: "disabled" }, output_config: { effort: "xhigh" } });
    expect(xhigh.output_config.effort).toBe("high");
    const low = prepare({ model: "claude-sonnet-5-5", thinking: { type: "disabled" }, output_config: { effort: "low" } });
    expect(low.output_config.effort).toBe("low");
  });

  it("maps forced tool_choice to auto", () => {
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "any" } }).tool_choice).toEqual({ type: "auto" });
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "tool", name: "run", disable_parallel_tool_use: true } }).tool_choice)
      .toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("leaves non-forced tool_choice alone", () => {
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "auto" } }).tool_choice).toEqual({ type: "auto" });
    expect(prepare({ model: "claude-sonnet-5-5", tool_choice: { type: "none" } }).tool_choice).toEqual({ type: "none" });
  });

  it("leaves enabled thinking alone", () => {
    const body = prepare({ model: "claude-sonnet-5-5", thinking: { type: "enabled", budget_tokens: 4096 } });
    expect(body.thinking.type).toBe("enabled");
  });

  it("leaves other models untouched", () => {
    const body = prepare({ model: "claude-sonnet-5", thinking: { type: "disabled" }, tool_choice: { type: "any" } });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  it("covers the native Claude passthrough path end to end", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-5-5", {
      model: "claude-sonnet-5-5", max_tokens: 1000, thinking: { type: "disabled" }, tool_choice: { type: "any" },
      tools: [{ name: "run", input_schema: { type: "object", properties: {} } }],
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "claude");
    expect(out.thinking).toEqual({ type: "between_tools" });
    expect(out.tool_choice).toEqual({ type: "auto" });
  });

  it("covers the OpenAI-client path end to end", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-5-5", {
      model: "claude-sonnet-5-5", reasoning_effort: "none", tool_choice: "required",
      tools: [{ type: "function", function: { name: "run", parameters: { type: "object", properties: {} } } }],
      messages: [{ role: "user", content: "hi" }],
    }, true, null, "claude");
    expect(out.thinking).toEqual({ type: "between_tools" });
    expect(out.tool_choice.type).toBe("auto");
  });
});
