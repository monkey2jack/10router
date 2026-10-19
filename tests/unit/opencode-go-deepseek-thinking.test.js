// 上游 08b21fea 的门控扩展（思路重实现）：opencode-go 的 /messages 通道托管的
// DeepSeek 模型与官方 deepseek 供应商一样要求 thinking 块回传，缺块时上游 400
// "thinking must be passed back"。prepareClaudeRequest 的门控因此按模型精确判定
// ——仅 opencode-go + ^deepseek- 模型注入未签名占位，同走 /messages 的 minimax/qwen
// 等模型族必须原样放行。
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

function makeBody(model, { thinking = true } = {}) {
  const body = {
    model,
    max_tokens: 2048,
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "18C" }],
      },
    ],
  };
  if (thinking) body.thinking = { type: "enabled", budget_tokens: 1024 };
  return body;
}

const firstBlock = (body) => body.messages[0].content[0];

describe("prepareClaudeRequest — opencode-go 托管 DeepSeek 的 thinking 回传", () => {
  it("裸 deepseek id：tool_use 轮缺 thinking 时注入未签名占位", () => {
    const out = prepareClaudeRequest(makeBody("deepseek-v4-pro"), "opencode-go");
    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
    expect(out.messages[0].content).toHaveLength(2); // 占位 + tool_use
  });

  it("带供应商前缀与 (level) 后缀的 id 同样命中门控", () => {
    const out = prepareClaudeRequest(makeBody("opencode-go/deepseek-v4-flash(max)"), "opencode-go");
    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
  });

  it("已有 thinking 块原样保留（不重签、不重复注入）", () => {
    const body = makeBody("deepseek-v4-flash");
    const realThinking = { type: "thinking", thinking: "actual reasoning", signature: "sig_from_upstream" };
    body.messages[0].content.unshift(realThinking);
    const out = prepareClaudeRequest(body, "opencode-go");
    const thinking = out.messages[0].content.filter((b) => b.type === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toEqual(realThinking);
  });

  it("门控不扩到 opencode-go 其他 /messages 模型族（minimax 原样放行）", () => {
    const out = prepareClaudeRequest(makeBody("minimax-m3"), "opencode-go");
    expect(out.messages[0].content).toHaveLength(1); // 仅 tool_use
    expect(firstBlock(out).type).toBe("tool_use");
  });

  it("仅包含 deepseek 关键字但非 ^deepseek- 前缀的 id 不命中", () => {
    const out = prepareClaudeRequest(makeBody("my-deepseek-9"), "opencode-go");
    expect(out.messages[0].content).toHaveLength(1);
    expect(firstBlock(out).type).toBe("tool_use");
  });

  it("thinking 未启用时不注入占位", () => {
    const out = prepareClaudeRequest(makeBody("deepseek-v4-pro", { thinking: false }), "opencode-go");
    expect(out.messages[0].content).toHaveLength(1);
    expect(firstBlock(out).type).toBe("tool_use");
  });

  it("回归：官方 deepseek 供应商保持注入未签名占位", () => {
    const out = prepareClaudeRequest(makeBody("deepseek-v4-pro"), "deepseek");
    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
  });
});
