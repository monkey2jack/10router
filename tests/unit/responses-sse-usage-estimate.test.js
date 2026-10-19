// Code-review finding on the #48 fix: on the Responses-API forced-SSE-to-JSON
// path, the estimate substituted by usageOrEstimate is OpenAI-shaped
// (prompt_tokens/completion_tokens) but the Details-row math read Responses
// fields (input_tokens/output_tokens) — so a Responses upstream that reported
// no usage still wrote 0/0 into requestDetails while the Overview got the
// estimate. The Overview-vs-Details disagreement issue #48 is about, alive on
// exactly one path.
//
// This drives the REAL handler end-to-end (sseToJsonHandler.js imports no JSX,
// so it is reachable under tests/vitest.config.js) with a Responses SSE stream
// that carries no usage block, and asserts both DB writers agree.
import { describe, expect, it, vi, beforeEach } from "vitest";

const saveRequestDetail = vi.fn(async () => {});
const saveRequestUsage = vi.fn(async () => {});
const appendRequestLog = vi.fn(async () => {});

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: (...a) => saveRequestDetail(...a),
  saveRequestUsage: (...a) => saveRequestUsage(...a),
  appendRequestLog: (...a) => appendRequestLog(...a),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// A Responses SSE stream that reports completion but NO usage block — the
// conversion layer fills in { input_tokens: 0, output_tokens: 0, total_tokens: 0 }.
const SSE = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_1","created_at":1700000000}}',
  '',
  'event: response.output_item.done',
  'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"an answer long enough to estimate from"}]}}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
  '',
  'data: [DONE]',
  '',
].join("\n");

function context(sourceFormat) {
  return {
    providerResponse: new Response(SSE, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "some-responses-upstream",
    model: "gpt-5",
    body: { model: "gpt-5", messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: { model: "gpt-5" },
    finalBody: { model: "gpt-5" },
    requestStartTime: Date.now(),
    connectionId: "conn-1",
    apiKey: null,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess: null,
    customToolNames: null,
    toolNameMap: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqTag: "test",
  };
}

beforeEach(() => {
  saveRequestDetail.mockClear();
  saveRequestUsage.mockClear();
  appendRequestLog.mockClear();
});

describe("Responses SSE without usage: estimate reaches BOTH tabs (#48)", () => {
  it("the detail row (Details tab) records the estimated tokens, not 0/0", async () => {
    await handleForcedSSEToJson(context(FORMATS.OPENAI));
    const detail = saveRequestDetail.mock.calls.at(-1)?.[0];
    expect(detail).toBeTruthy();
    expect(detail.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(detail.tokens.completion_tokens).toBeGreaterThan(0);
  });

  it("the usage row (Overview tab) records the same estimate", async () => {
    await handleForcedSSEToJson(context(FORMATS.OPENAI));
    const usage = saveRequestUsage.mock.calls.at(-1)?.[0]?.tokens;
    expect(usage).toBeTruthy();
    expect(usage.prompt_tokens ?? usage.input_tokens).toBeGreaterThan(0);
  });

  it("the two tabs agree on the numbers", async () => {
    await handleForcedSSEToJson(context(FORMATS.OPENAI));
    const usage = saveRequestUsage.mock.calls.at(-1)?.[0]?.tokens;
    const detail = saveRequestDetail.mock.calls.at(-1)?.[0].tokens;
    // canonicalizeUsage folds cache fields; for an estimate both are bare
    // prompt/completion, so the figures must match exactly.
    expect(detail.prompt_tokens).toBe(usage.prompt_tokens);
    expect(detail.completion_tokens).toBe(usage.completion_tokens);
  });

  it("a real Responses usage block is still reported as-is to the client", async () => {
    // The estimate must never leak onto the wire: only the DB rows may be
    // estimated. With a REAL usage block the client-facing build reads it
    // verbatim (cache-inclusive fold), untouched by the fallback.
    const withUsage = SSE.replace(
      '"status":"completed"',
      '"status":"completed","usage":{"input_tokens":111,"output_tokens":22,"total_tokens":133}',
    );
    const ctx = context(FORMATS.OPENAI);
    ctx.providerResponse = new Response(withUsage, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const result = await handleForcedSSEToJson(ctx);
    const wire = JSON.parse(await result.response.text());
    expect(wire.usage.prompt_tokens).toBe(111);
    expect(wire.usage.completion_tokens).toBe(22);
    expect(wire.usage.estimated).toBeUndefined();
  });
});
