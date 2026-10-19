import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor, parseCodeBuddyFrequencyLimit } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

// 上游错误体形状钉样：
//   CN：  { code: 6004, message: "当前模型超出频率限制，请于 2026-09-28 14:30:00 后重试" }
//   INTL：{ code: <业务码>, msg: "frequency limit exceeded, please retry after 2026-09-28 12:00:00 UTC+0" }
// 命中后统一输出 { status: 429, message, resetsAtMs }，resetsAtMs 经
// markAccountUnavailable 的精确冷却通道冷却账号。
describe("CodeBuddy parseError 6004 → resetsAtMs", () => {
  it("codebuddy-cn：code=6004 + 中文消息，默认时区 UTC+8", () => {
    const executor = new CodeBuddyExecutor();
    const bodyText = JSON.stringify({
      code: 6004,
      message: "当前模型超出频率限制，请于 2026-09-28 14:30:00 后重试",
    });

    const parsed = executor.parseError({ status: 200 }, bodyText);
    expect(parsed.status).toBe(429);
    expect(parsed.message).toContain("超出频率限制");
    expect(parsed.resetsAtMs).toBe(new Date("2026-09-28T14:30:00+08:00").getTime());
  });

  it("codebuddy-intl：无 6004、msg 文案命中频率限制，按声明时区 UTC+0 解析", () => {
    const executor = new CodeBuddyIntlExecutor();
    const bodyText = JSON.stringify({
      code: 11000,
      msg: "frequency limit exceeded, please retry after 2026-09-28 12:00:00 UTC+0",
    });

    const parsed = executor.parseError({ status: 400 }, bodyText);
    expect(parsed.status).toBe(429);
    expect(parsed.message).toContain("frequency limit");
    expect(parsed.resetsAtMs).toBe(new Date("2026-09-28T12:00:00+00:00").getTime());
  });

  it("冒号时区 UTC+8:00 一并支持", () => {
    const parsed = parseCodeBuddyFrequencyLimit(
      JSON.stringify({ code: 6004, msg: "超出频率限制，重置时间 2026-10-02 08:00:00 UTC+8:00" })
    );
    expect(parsed.resetsAtMs).toBe(new Date("2026-10-02T08:00:00+08:00").getTime());
  });

  it("6004 但消息无时间：resetsAtMs 为 null，仍归一为 429", () => {
    const parsed = parseCodeBuddyFrequencyLimit(
      JSON.stringify({ code: 6004, message: "超出频率限制" })
    );
    expect(parsed).toEqual({
      status: 429,
      message: "超出频率限制",
      resetsAtMs: null,
    });
  });

  it("error.message 嵌套形状也能取到消息", () => {
    const parsed = parseCodeBuddyFrequencyLimit(
      JSON.stringify({ code: 6004, error: { message: "超出频率限制，请于 2026-09-29 00:00:00 后重试" } })
    );
    expect(parsed.message).toContain("超出频率限制");
    expect(parsed.resetsAtMs).toBe(new Date("2026-09-29T00:00:00+08:00").getTime());
  });

  it("无关错误回退 BaseExecutor 默认解析", () => {
    const executor = new CodeBuddyExecutor();
    const bodyText = JSON.stringify({
      code: 11101,
      message: "Non-stream chat request is currently not supported",
    });

    const parsed = executor.parseError({ status: 400 }, bodyText);
    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe(bodyText);
    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("非 JSON 错误体回退默认解析，不抛异常", () => {
    const executor = new CodeBuddyIntlExecutor();
    const parsed = executor.parseError({ status: 502 }, "<html>bad gateway</html>");
    expect(parsed.status).toBe(502);
    expect(parsed.message).toBe("<html>bad gateway</html>");
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});
