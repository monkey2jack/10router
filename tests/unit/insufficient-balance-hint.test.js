import { describe, expect, it } from "vitest";
import {
  isInsufficientBalanceText,
  withInsufficientBalanceHint,
} from "../../open-sse/services/accountFallback.js";
import { unavailableResponse } from "../../open-sse/utils/error.js";

/**
 * "余额不足" 的友好提示（TokenRouter 403 insufficient_user_quota）。
 *
 * 回归背景：旧正则只有 `insufficient[_ -]balance|余额不足|欠费`，而 TokenRouter
 * 实际返回的是两套别的措辞，一条都不命中——用户只看到带 request id 的英文
 * JSON，既不知道这是余额问题，也不知道该去充值。
 */
const TR_FREE = JSON.stringify({
  error: {
    message: "User's credit limit is insufficient, remaining credit limit: $0.000000",
    type: "api_error",
    code: "insufficient_user_quota",
  },
});
const TR_PAID = JSON.stringify({
  error: {
    message: "This model cannot use part of your gift balance, remaining eligible quota: $0.000000, required pre-deduction amount: $0.000002",
    code: "insufficient_user_quota",
  },
});

describe("isInsufficientBalanceText", () => {
  it("识别 TokenRouter 两种真实措辞", () => {
    expect(isInsufficientBalanceText(TR_FREE)).toBe(true);
    expect(isInsufficientBalanceText(TR_PAID)).toBe(true);
  });

  it("保留原有识别口径", () => {
    expect(isInsufficientBalanceText("insufficient_balance")).toBe(true);
    expect(isInsufficientBalanceText("余额不足，请充值")).toBe(true);
    expect(isInsufficientBalanceText("You exceeded your current quota")).toBe(true);
  });

  it("不误伤限流 / 参数错误 / 网络错误", () => {
    expect(isInsufficientBalanceText("Rate limit reached for gpt-5")).toBe(false);
    expect(isInsufficientBalanceText('{"error":{"message":"invalid parameter: temperature"}}')).toBe(false);
    expect(isInsufficientBalanceText("fetch failed ECONNRESET")).toBe(false);
  });
});

describe("withInsufficientBalanceHint", () => {
  it("TokenRouter 追加专属出路，并点明 :free 档同样吃额度", () => {
    const out = withInsufficientBalanceHint(TR_FREE, "tokenrouter");
    expect(out).toContain("余额不足");
    expect(out).toContain("tokenrouter.com/console");
    expect(out).toContain(":free");
    expect(out).toContain("insufficient_user_quota");
  });

  it("其它 provider 只加通用提示，不带 TokenRouter 专属段落", () => {
    const out = withInsufficientBalanceHint(TR_FREE, "minimax");
    expect(out).toContain("余额不足");
    expect(out).not.toContain("tokenrouter.com");
  });

  it("非余额错误原样返回，逐字节不变", () => {
    const msg = "Rate limit reached for gpt-5";
    expect(withInsufficientBalanceHint(msg, "tokenrouter")).toBe(msg);
  });
});

describe("unavailableResponse 对余额错误不挂倒计时", () => {
  it("TokenRouter 403 不出现 reset after", async () => {
    const res = unavailableResponse(
      402, withInsufficientBalanceHint(TR_FREE, "tokenrouter"),
      new Date(Date.now() + 60000).toISOString(), "reset after 60s",
    );
    const json = await res.json();
    expect(json.error.message).not.toContain("reset after 60s");
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
