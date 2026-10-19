// 非 messages[] 源格式（Gemini contents[]、Responses input[]）用自己的形状携带
// 客户端的末轮 role。显式的尾部 model/assistant 轮是真 prefill，翻译到 Claude 后
// 必须保留；被清空的尾部 user 轮仍要补回 "Continue." 占位。（上游 5e9bd464）
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

const roles = (body) => body.messages.map((m) => m.role);
const MODEL = "claude-sonnet-5";

describe("trailing user turn: non-messages[] source formats", () => {
  it("keeps a Gemini trailing model turn (real prefill)", () => {
    const out = translateRequest("gemini", "claude", MODEL, {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "The answer is" }] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
    expect(out.messages.at(-1).content[0].text).toBe("The answer is");
  });

  it("keeps a Responses trailing assistant message (real prefill)", () => {
    const out = translateRequest("openai-responses", "claude", MODEL, {
      model: MODEL,
      input: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "The answer is" },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
    expect(out.messages.at(-1).content[0].text).toBe("The answer is");
  });

  it("still restores a user turn when a Gemini trailing user turn is emptied", () => {
    const out = translateRequest("gemini", "claude", MODEL, {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
        { role: "user", parts: [] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });
});
