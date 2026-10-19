// #48: 概览页空白、详情页有行但全是 0。
//
// 两个 tab 读的是两张表：概览读 usageDaily/usageHistory（saveUsageStats 写），
// 详情读 requestDetails（saveRequestDetail 写）。两者的写入门限原本不对称：
//   - requestDetail.js 的 saveUsageStats：`in === 0 && out === 0` 直接 return，
//     所以没有 usage 的非流式响应在概览侧整行被丢掉；
//   - nonStreamingHandler：却无条件把 { prompt_tokens: 0, completion_tokens: 0 }
//     写进详情，于是详情侧留下一行 0/0。
//
// 缺失的一环是「估算兜底」：SSE 路径一直有 estimateUsage 兜底（stream.js 四处），
// 非流式路径只有 extractUsageFromResponse，认不出的 usage 形状就返回 null。
// 本文件钉住修复后的行为，并确保估算值不会泄到发给客户端的响应里
// （客户端 usage 与 DB 记录必须同源，见下面 recordedUsage / 上游 usage 的区分）。
import { describe, expect, it, vi, beforeEach } from "vitest";

const saveRequestDetail = vi.fn(async () => {});
const appendRequestLog = vi.fn(async () => {});

// saveUsageStats（open-sse/handlers/chatCore/requestDetail.js）不是从 usageDb
// 直接 import 的——它是个 wrapper，最终落到 saveRequestUsage。所以要观察
// 「概览那一侧到底写没写」，得看 saveRequestUsage 的调用。
const saveRequestUsage = vi.fn(async () => {});

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: (...a) => appendRequestLog(...a),
  saveRequestDetail: (...a) => saveRequestDetail(...a),
  saveRequestUsage: (...a) => saveRequestUsage(...a),
  saveUsageStats: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { measureResponseTextLength } = await import("../../open-sse/utils/usageTracking.js");

const BODY = {
  model: "some-model",
  messages: [{ role: "user", content: "hello there, please answer" }],
};

function context(responseBody) {
  return {
    providerResponse: new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    provider: "openai-compatible-chat",
    model: "some-model",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: BODY,
    stream: false,
    translatedBody: BODY,
    finalBody: BODY,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
  };
}

const USAGE_LESS = {
  id: "chatcmpl-x",
  object: "chat.completion",
  model: "some-model",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "x".repeat(400) },
    finish_reason: "stop",
  }],
  // 上游没回 usage —— 这正是 #48 的触发条件
};

// 概览侧那一行：saveUsageStats 把 tokens 交给 saveRequestUsage
const lastUsageStats = () => saveRequestUsage.mock.calls.at(-1)?.[0]?.tokens;
const lastDetail = () => saveRequestDetail.mock.calls.at(-1)?.[0];

beforeEach(() => {
  saveRequestUsage.mockClear();
  saveRequestDetail.mockClear();
  appendRequestLog.mockClear();
});

describe("#48 non-streaming usage is estimated when the provider omits it", () => {
  it("records a non-zero row for saveUsageStats (Overview tab) instead of dropping it", async () => {
    await handleNonStreamingResponse(context(USAGE_LESS));
    const tokens = lastUsageStats();
    expect(tokens).toBeTruthy();
    // 400 chars of answer → ~100 completion tokens; input is non-zero from BODY
    expect(tokens.completion_tokens).toBeGreaterThan(0);
    expect(tokens.prompt_tokens).toBeGreaterThan(0);
  });

  it("records the SAME numbers in the detail row (Details tab), so the tabs agree", async () => {
    await handleNonStreamingResponse(context(USAGE_LESS));
    const detail = lastDetail();
    expect(detail.tokens.prompt_tokens).toBe(lastUsageStats().prompt_tokens);
    expect(detail.tokens.completion_tokens).toBe(lastUsageStats().completion_tokens);
  });

  it("marks the estimate as estimated at the source (the stored row canonicalizes it away)", async () => {
    // canonicalizeUsage() rebuilds a fixed 4-key object, so `estimated` does not
    // reach the DB — same as the pre-existing SSE path. Pin the flag on
    // estimateUsage itself instead, which is where the honesty signal lives.
    const { estimateUsage } = await import("../../open-sse/utils/usageTracking.js");
    expect(estimateUsage(BODY, 400, FORMATS.OPENAI).estimated).toBe(true);
  });

  it("never puts an all-zero row in requestDetails when text came back", async () => {
    await handleNonStreamingResponse(context(USAGE_LESS));
    const { tokens } = lastDetail();
    expect(tokens.prompt_tokens + tokens.completion_tokens).toBeGreaterThan(0);
  });

  it("leaves a real upstream usage untouched — no estimate substitution", async () => {
    const withUsage = {
      ...USAGE_LESS,
      usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
    };
    await handleNonStreamingResponse(context(withUsage));
    const tokens = lastUsageStats();
    expect(tokens.prompt_tokens).toBe(111);
    expect(tokens.completion_tokens).toBe(222);
    expect(tokens.estimated).toBeUndefined();
  });

  it("does not estimate when the response carries no text at all", async () => {
    // 空 content：没有可估算的输出，仍应保持既有的「不写全零行」行为
    await handleNonStreamingResponse(context({
      ...USAGE_LESS,
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
    }));
    expect(lastUsageStats()).toBeFalsy();
  });

  it("does not change the usage the client receives on the wire", async () => {
    // 客户端拿到的是 translatedResponse.usage，不是 DB 记录用的那份估算值。
    // 没有上游 usage 时不应凭空造一个 usage 字段发给客户端。
    const result = await handleNonStreamingResponse(context(USAGE_LESS));
    const wire = JSON.parse(await result.response.text());
    expect(wire.usage).toBeUndefined();
  });
});

describe("measureResponseTextLength covers the shapes the non-streaming path sees", () => {
  it("counts OpenAI choices[].message.content", () => {
    expect(measureResponseTextLength({ choices: [{ message: { content: "abcd" } }] })).toBe(4);
  });

  it("counts reasoning_content too, mirroring the SSE path", () => {
    const n = measureResponseTextLength({ choices: [{ message: { content: "ab", reasoning_content: "xyz" } }] });
    expect(n).toBe(5);
  });

  it("counts Claude content[] text and thinking blocks", () => {
    expect(measureResponseTextLength({ content: [{ type: "text", text: "abc" }, { type: "thinking", thinking: "skip" }] })).toBe(3);
  });

  it("counts Responses API output[].content[].text", () => {
    expect(measureResponseTextLength({ output: [{ type: "message", content: [{ type: "output_text", text: "abcd" }] }] })).toBe(4);
  });

  it("counts array-shaped OpenAI content parts", () => {
    expect(measureResponseTextLength({ choices: [{ message: { content: [{ text: "ab" }, { text: "cde" }] } }] })).toBe(5);
  });

  it("returns 0 for nothing usable, so callers keep their existing guard", () => {
    expect(measureResponseTextLength(null)).toBe(0);
    expect(measureResponseTextLength({})).toBe(0);
    expect(measureResponseTextLength({ choices: [] })).toBe(0);
    expect(measureResponseTextLength({ choices: [{ message: { content: 42 } }] })).toBe(0);
  });
});
