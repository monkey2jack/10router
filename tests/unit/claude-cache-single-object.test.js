// 上游 8a81085a 的单对象 content 半（#3795/#3567 交互）：部分客户端把 content 发成
// 裸块对象而非单元素数组，各读取路径会把它丢掉或清零。预算修剪半未移植——我们的
// anchorClaudeCache/prepareClaudeRequest 一律剥光客户端标记再按面重打锚点：system 1 +
// tools 1 + messages ≤1，工具循环的末轮 tool_result 再补第 4 个 5m 断点（上游 49c761cd），
// 按构造恒在 4-marker 预算内，末尾的 "markers ≤ 3" 不变量测试（结尾为手打消息的请求
// 拿不到第 4 断点）就是这一决策的回退网。
import { describe, it, expect } from "vitest";
import {
  anchorClaudeCache,
  normalizeClaudePassthrough,
  prepareClaudeRequest,
} from "../../open-sse/translator/formats/claude.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const CC = { type: "ephemeral" };
const text = (t, extra = {}) => ({ type: "text", text: t, ...extra });
const tool = (name, extra = {}) => ({ name, description: "d", input_schema: {}, ...extra });

// counts markers incl. single-object content — mirrors the upstream contract
function countMarkers(body) {
  let n = 0;
  if (Array.isArray(body.system)) for (const b of body.system) if (b?.cache_control) n++;
  if (Array.isArray(body.tools)) for (const t of body.tools) if (t?.cache_control) n++;
  if (Array.isArray(body.messages)) for (const m of body.messages) {
    if (Array.isArray(m?.content)) {
      for (const b of m.content) if (b?.cache_control) n++;
    } else if (m?.content && typeof m.content === "object" && m.content.cache_control) n++;
  }
  return n;
}

describe("single-block content normalization", () => {
  it("normalizes a single-object turn in passthrough and anchors it", () => {
    const body = {
      messages: [
        { role: "user", content: [text("u1")] },
        { role: "assistant", content: text("a1") },     // single object, no marker
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const assistant = body.messages.find(m => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant.content)).toBe(true); // base: still bare object
    expect(assistant.content).toHaveLength(1);
    const out = anchorClaudeCache(body);
    expect(countMarkers(out)).toBe(1);
  });

  it("keeps a turn whose content is a single object and strips its marker", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1")],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    const kept = out.messages.filter(m => JSON.stringify(m.content).includes("u1"));
    expect(kept.length).toBe(1);                        // base: 0 (dropped)
    expect(kept[0].content).toHaveLength(1);           // normalized to array
    expect(kept[0].content[0].cache_control).toBeUndefined();
  });

  it("drops no conversation turn when content is a single text object", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [text("q")] },
      ],
    }, "claude");
    expect(out.messages.length).toBe(3);               // base: 1
    expect(Array.isArray(out.messages[0].content)).toBe(true);
  });

  it("keeps single-object turns on the claude-to-openai leg", () => {
    const out = claudeToOpenAIRequest("any", {
      model: "claude-sonnet-5", max_tokens: 100,
      messages: [
        { role: "user", content: text("u1") },
        { role: "assistant", content: [text("a1")] },
        { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }] },
      ],
    }, false);
    expect(out.messages.some(m => JSON.stringify(m.content).includes("u1"))).toBe(true); // base: dropped
    const img = out.messages.find(m => JSON.stringify(m.content).includes("image_url"));
    expect(img).toBeDefined();                          // base: dropped
  });

  it("keeps a bare-object user turn folded with a mid-conversation system message", () => {
    const body = {
      messages: [
        { role: "user", content: text("u1") },
        { role: "system", content: [text("reminder")] },
        { role: "user", content: [text("q")] },
      ],
    };
    normalizeClaudePassthrough(body);
    const first = body.messages[0];
    expect(Array.isArray(first.content)).toBe(true);
    expect(JSON.stringify(first.content).includes("u1")).toBe(true); // pre-hoist: fold zeroes bare-object content
    expect(JSON.stringify(first.content).includes("reminder")).toBe(true);
  });
});

describe("our marker-budget invariant (why the upstream trim is not ported)", () => {
  it("stays at ≤3 markers even when the client spent the whole budget", () => {
    // Our policy strips every client marker and re-anchors at most one block per
    // surface — the over-budget 400 upstream fixed cannot occur here.
    const out = anchorClaudeCache({
      system: [text("s1"), text("s2", { cache_control: CC })],
      tools: [tool("t1"), tool("t2", { cache_control: CC })],
      messages: [
        { role: "user", content: text("u1", { cache_control: CC }) },
        { role: "assistant", content: text("a1", { cache_control: CC }) },
        { role: "user", content: [text("q")] },
      ],
    });
    expect(countMarkers(out)).toBeLessThanOrEqual(3);
    expect(out.system.at(-1).cache_control?.ttl).toBe("1h");
    expect(out.tools.find(t => t.name === "t2").cache_control?.ttl).toBe("1h");
  });

  it("prepareClaudeRequest stays within budget with marked tools", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-5", max_tokens: 100,
      system: [text("s1", { cache_control: CC })],
      tools: [tool("t1", { cache_control: CC }), tool("t2", { cache_control: CC }), tool("t3", { cache_control: CC }), tool("t4", { cache_control: CC })],
      messages: [{ role: "user", content: [text("q", { cache_control: CC })] }],
    }, "claude");
    expect(countMarkers(out)).toBeLessThanOrEqual(3);
  });
});
