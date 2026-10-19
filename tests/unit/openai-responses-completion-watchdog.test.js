import { describe, expect, it, vi, afterEach } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// chat→responses 直连路由在 finish_reason 后等真实 usage 尾部 chunk,期间
// response.completed 被延迟(state.completionPending,见
// translator/response/openai-responses.js)。坏上游 stall(无尾部 chunk、
// 无 [DONE]、连接不断开)时这个等待会无界挂起 —— stream.js 的 3s watchdog
// 兜底补发终态事件;正常路径(usage 尾部 chunk / [DONE] / 连接关闭)立即补发
// 并取消 watchdog,只有 stall 的流才吃这 3s。
const encoder = new TextEncoder();

const FINISH_CHUNK = {
  id: "chatcmpl-1",
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }],
};

const USAGE_TRAILER = {
  id: "chatcmpl-1",
  choices: [],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
};

function completedResponses(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.includes('"type":"response.completed"'))
    .map((l) => JSON.parse(l.slice(6)).response);
}

async function readAll(reader) {
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// chat 上游(targetFormat=OPENAI)→ responses 客户端(sourceFormat=OPENAI_RESPONSES)
async function pipe() {
  let source;
  const input = new ReadableStream({ start(c) { source = c; } });
  const output = input.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "test", null, null, "gpt-test"),
  );
  return { source, reader: output.getReader() };
}

describe("延迟 response.completed 的 3s watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finish 后上游 stall:watchdog 超时兜底补发,恰一条 completed", async () => {
    vi.useFakeTimers();
    const { source, reader } = await pipe();
    source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
    await vi.advanceTimersByTimeAsync(20);

    // 无尾部 usage、无 [DONE] —— 只有 watchdog 能结束这条流。
    await vi.advanceTimersByTimeAsync(3000);
    source.close();

    const completed = completedResponses(await readAll(reader));
    expect(completed.length, "恰一条 response.completed").toBe(1);
    expect(completed[0].status).toBe("completed");
    expect(completed[0].usage, "从未上报 usage").toBeUndefined();
  });

  it("usage 尾部 chunk 正常到达:立即补发(不等 watchdog),不双发且带 usage", async () => {
    vi.useFakeTimers();
    const { source, reader } = await pipe();
    source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
    await vi.advanceTimersByTimeAsync(20);
    source.enqueue(encoder.encode(`data: ${JSON.stringify(USAGE_TRAILER)}\n\n`));
    await vi.advanceTimersByTimeAsync(20);

    // 远超 watchdog 窗口:不许再发出第二条 completed。
    await vi.advanceTimersByTimeAsync(10000);
    source.close();

    const completed = completedResponses(await readAll(reader));
    expect(completed.length, "恰一条 response.completed").toBe(1);
    expect(completed[0].usage).toMatchObject({ input_tokens: 120, output_tokens: 30 });
  });

  it("[DONE] 到达:立即补发并取消 watchdog", async () => {
    vi.useFakeTimers();
    const { source, reader } = await pipe();
    source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
    await vi.advanceTimersByTimeAsync(20);
    source.enqueue(encoder.encode("data: [DONE]\n\n"));
    await vi.advanceTimersByTimeAsync(20);

    await vi.advanceTimersByTimeAsync(10000);
    source.close();

    const completed = completedResponses(await readAll(reader));
    expect(completed.length, "恰一条 response.completed").toBe(1);
  });

  it("连接直接关闭:flush 路径补发,watchdog 不再触发", async () => {
    vi.useFakeTimers();
    const { source, reader } = await pipe();
    source.enqueue(encoder.encode(`data: ${JSON.stringify(FINISH_CHUNK)}\n\n`));
    await vi.advanceTimersByTimeAsync(20);
    source.close();
    await vi.advanceTimersByTimeAsync(10000);

    const completed = completedResponses(await readAll(reader));
    expect(completed.length, "恰一条 response.completed").toBe(1);
    expect(completed[0].status).toBe("completed");
  });
});
