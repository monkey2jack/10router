// codebuddy-intl DeepSeek reasoning_effort translation (400 code 11150) merged with
// upstream's 11155 tool-turn guard.
//
// 11150: DeepSeek-series models reject BOTH "auto" and "off" with
//   "reasoning effort value is not supported by the current model" — they only accept
//   low/medium/high/xhigh/max/none. Agent clients (e.g. dsh sending THINK:auto) must not
//   hard-fail, so auto → high and off → omitted.
//
// 11155 (upstream v1.1.2): when any prior assistant turn with tool_calls lacks
//   reasoning_content, reasoning params must be dropped or upstream rejects the turn.
//   Our translation must NOT clobber this guard.
import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const MSG = [{ role: "user", content: "hi" }];
const TOOL_TURN = (reasoning) => [
  { role: "user", content: "hi" },
  {
    role: "assistant",
    tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }],
    ...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
  },
];

describe("CodeBuddyIntlExecutor DeepSeek effort translation (11150)", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("maps THINK:auto → high for deepseek models", () => {
    const out = exec.transformRequest(
      "deepseek-v4-pro",
      { messages: MSG, reasoning_effort: "auto" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBe("high");
  });

  it("keeps reasoning_summary:auto alongside the translated high", () => {
    const out = exec.transformRequest(
      "deepseek-v4-flash",
      { messages: MSG, reasoning_effort: "auto" },
      false,
      {}
    );
    expect(out.reasoning_summary).toBe("auto");
  });

  it("drops reasoning_effort for deepseek + off", () => {
    const out = exec.transformRequest(
      "deepseek-v4-pro",
      { messages: MSG, reasoning_effort: "off" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("passes through legal levels unchanged", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      const out = exec.transformRequest(
        "deepseek-v4-pro",
        { messages: MSG, reasoning_effort: level },
        false,
        {}
      );
      expect(out.reasoning_effort).toBe(level);
    }
  });

  it("leaves NON-deepseek models alone (auto stays auto)", () => {
    const out = exec.transformRequest(
      "glm-5.1",
      { messages: MSG, reasoning_effort: "auto" },
      false,
      {}
    );
    // Non-deepseek: falls to the generic `else if (eff)` branch, which only sets
    // reasoning_summary — it does not rewrite reasoning_effort.
    expect(out.reasoning_effort).toBe("auto");
    expect(out.reasoning_summary).toBe("auto");
  });
});

describe("CodeBuddyIntlExecutor preserves upstream 11155 tool-turn guard", () => {
  const exec = new CodeBuddyIntlExecutor();

  it("drops reasoning params when a tool turn lacks reasoning_content", () => {
    const out = exec.transformRequest(
      "glm-5.1",
      { messages: TOOL_TURN(undefined), reasoning_effort: "high" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });

  it("keeps reasoning params when the tool turn HAS reasoning_content", () => {
    const out = exec.transformRequest(
      "glm-5.1",
      { messages: TOOL_TURN("thought"), reasoning_effort: "high" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning_summary).toBe("auto");
  });

  it("drops reasoning for deepseek+auto when a prior tool turn lacks reasoning_content", () => {
    // 11155 wins here: super.transformRequest() runs injectReasoningContent, which for
    // DeepSeek fills a " " placeholder into every unreasoned assistant turn. Testing the
    // post-injection array would make the guard permanently false (the old bug), so the
    // guard must read the ORIGINAL body — and then it must drop reasoning, not emit "high".
    const out = exec.transformRequest(
      "deepseek-v4-pro",
      { messages: TOOL_TURN(undefined), reasoning_effort: "auto" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });

  it("drops reasoning for deepseek+high when a prior tool turn lacks reasoning_content", () => {
    const out = exec.transformRequest(
      "deepseek-v4-pro",
      { messages: TOOL_TURN(undefined), reasoning_effort: "high" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });

  it("matches DeepSeek case-insensitively (the injector uses /deepseek/i)", () => {
    // A capitalized or aliased id must still get the 11150 translation; /^deepseek/ missed these.
    for (const m of ["DeepSeek-v4-pro", "DEEPSEEK-V4-PRO", "deepseek-ai/deepseek-v4-flash"]) {
      const out = exec.transformRequest(m, { messages: MSG, reasoning_effort: "auto" }, false, {});
      expect(out.reasoning_effort).toBe("high");
    }
  });

  it("drops a non-string reasoning_effort instead of forwarding it (11150)", () => {
    // A malformed value (true/{}/[]/0) is not a level; upstream answers it with 400
    // 11150 exactly like "auto". It must not reach the wire.
    for (const bad of [true, {}, [], 0]) {
      const out = exec.transformRequest("deepseek-v4.1-flash", { messages: MSG, reasoning_effort: bad }, false, {});
      expect(out.reasoning_effort).toBeUndefined();
    }
  });

  it("drops the field for deepseek+off with an unreasoned tool turn", () => {
    const out = exec.transformRequest(
      "deepseek-v4-pro",
      { messages: TOOL_TURN(undefined), reasoning_effort: "off" },
      false,
      {}
    );
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning_summary).toBeUndefined();
  });
});
