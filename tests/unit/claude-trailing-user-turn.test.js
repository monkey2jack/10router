// 新版 Claude 拒绝以 assistant 轮结尾的请求体（400 "does not support assistant
// message prefill"）。各清理通道会删掉被清空的消息，于是一个被清空的尾部 user 轮
// 会让上一轮 assistant 静默变成末轮。钉形状：尾部 user 轮保留（补 "Continue."
// 占位），正常清理不变，客户端有意的 prefill 不动。（上游 75834e96）
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const roles = (body) => body.messages.map((m) => m.role);
const MODEL = "claude-sonnet-5";
const history = (last) => [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "text", text: "hello" }] },
  last,
];

const emptyLastTurns = {
  "empty string": { role: "user", content: "" },
  "blank text block": { role: "user", content: [{ type: "text", text: "  " }] },
  "empty content array": { role: "user", content: [] },
  "unsupported block only": { role: "user", content: [{ type: "thinking", thinking: "" }] },
};

describe("trailing user turn survives empty-message cleanup", () => {
  for (const [name, last] of Object.entries(emptyLastTurns)) {
    it(`prepareClaudeRequest: ${name}`, () => {
      const out = prepareClaudeRequest({ model: MODEL, max_tokens: 100, messages: history(last) }, "claude");
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
    it(`normalizeClaudePassthrough: ${name}`, () => {
      const out = normalizeClaudePassthrough({ model: MODEL, messages: history(last) }, MODEL);
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
  }

  it("placeholder is a minimal user turn, not a mutation of history", () => {
    const out = prepareClaudeRequest({ model: MODEL, max_tokens: 100, messages: history({ role: "user", content: "" }) }, "claude");
    expect(out.messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "Continue." }] });
  });

  it("passthrough: tool_result of a dropped foreign server_tool_use no longer empties the last turn into prefill", () => {
    const out = normalizeClaudePassthrough({
      model: MODEL,
      messages: [
        { role: "user", content: "analyze" },
        { role: "assistant", content: [{ type: "server_tool_use", id: "call_abc", name: "analyze_image", input: {} }, { type: "text", text: "done" }] },
        { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "call_abc", content: [] }] },
      ],
    }, MODEL);
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });

  it("full pipeline: OpenAI client with an empty last user message", () => {
    const out = translateRequest("openai", "claude", MODEL, {
      model: "x", max_tokens: 100,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "" }],
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("full pipeline: Claude client with a blank last user block", () => {
    const out = translateRequest("claude", "claude", MODEL, {
      model: "x", max_tokens: 100, messages: history({ role: "user", content: [{ type: "text", text: "" }] }),
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("leaves intentional client prefill (last turn is assistant) untouched", () => {
    const body = { model: MODEL, max_tokens: 100, messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "Sure:" }] },
    ] };
    expect(roles(prepareClaudeRequest(structuredClone(body), "claude"))).toEqual(["user", "assistant"]);
    expect(roles(normalizeClaudePassthrough(structuredClone(body), MODEL))).toEqual(["user", "assistant"]);
  });

  it("leaves even an empty trailing assistant prefill untouched", () => {
    const body = { model: MODEL, max_tokens: 100, messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "" },
    ] };
    expect(roles(prepareClaudeRequest(structuredClone(body), "claude"))).toEqual(["user", "assistant"]);
  });

  it("does not append anything when the last user turn has content", () => {
    const out = prepareClaudeRequest({ model: MODEL, max_tokens: 100, messages: history({ role: "user", content: "next" }) }, "claude");
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
    expect(out.messages.at(-1).content[0].text).toBe("next");
  });
});
