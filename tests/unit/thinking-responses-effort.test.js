// 回归：Responses 族目标格式的思考强度字段是 reasoning.effort，不是
// reasoning_effort（Chat Completions 专属）。applyThinking 在 openai→responses
// 翻译器之后运行，若仍写 reasoning_effort，会原样漏到上游 → 400
// "Unsupported parameter: 'reasoning_effort' ... moved to 'reasoning.effort'"
// （ocg/gpt-6-luna 实测，2026-09-27）。
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("applyThinking: responses-family targets use reasoning.effort", () => {
  it("openai-responses target → reasoning:{effort}, no reasoning_effort leak", () => {
    const body = { reasoning_effort: "high" };
    const out = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-6-luna", body, "opencode-go");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "high" });
  });

  it("thinking intent applied on a translated responses body carries reasoning.effort", () => {
    // The real ocg path: claude source → openai intermediate → responses body,
    // THEN applyThinking runs — the effort must land in the responses shape.
    const body = { model: "gpt-6-luna", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    const out = applyThinking(FORMATS.OPENAI_RESPONSES, "gpt-6-luna", body, "opencode-go", { mode: "level", level: "high" });
    expect(out.reasoning).toEqual({ effort: "high" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("codex native passthrough keeps its own reasoning_effort contract", () => {
    // codex 的下游转换（reasoning_effort → reasoning + summary 回填）依赖
    // reasoning_effort 字段本身，不能在此层改写形态。
    const body = { reasoning_effort: "medium" };
    const out = applyThinking(FORMATS.CODEX, "gpt-5.6", body, "opencode-go");
    expect(out.reasoning_effort).toBe("medium");
  });

  it("plain openai target keeps reasoning_effort (chat completions)", () => {
    const body = { reasoning_effort: "high" };
    const out = applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
  });
});
