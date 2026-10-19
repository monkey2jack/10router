// Friendly 429 handling: (a) upstream rate-limit JSON must reach the client as
// an actionable sentence while non-rate-limit messages pass through untouched
// (so callers can wrap unconditionally), and (b) an explicit "wait N seconds"
// in the body must FLOOR the cooldown — plain exponential backoff starting at
// 2s re-hits an upstream that just asked for 23s. The cooldown is governed by
// ERROR_RULES { status: 429, backoff: true }; these tests pin both behaviors.
import { describe, it, expect } from "vitest";
import {
  isRateLimitText,
  withRateLimitHint,
  extractRetrySeconds,
  checkFallbackError,
} from "../../open-sse/services/accountFallback.js";

// Verbatim shapes from the NAS logs (2026-09-17).
const MIMO_429 =
  '{"error":{"code":"429","message":"Too Many Requests","param":"Request rate limited","type":""},"request_id":"63c52f77334b8d5e4f9796e311897a3b"}';
// The later shape states the exact window in the body — this is the one the
// 2s/4s/8s/16s storm was fighting against.
const MIMO_TPM_429 =
  '[429]: {"error":{"message":"用户 每人 触发 TPM 限流（上限 5000000），请约 23 秒后重试","type":"rate_limit_error","code":"rate_limited","biz_code":30014}}';
const CODEBUDDY_6004 = "[429]: {\"code\":6004,\"msg\":\"您的使用量已超出频率限制\"}";
const CHANNEL_11128 =
  '[400]: {"code":11128,"msg":"Illegal API invocation from an unapproved channel"}';

describe("isRateLimitText", () => {
  it("recognizes upstream429 shapes", () => {
    expect(isRateLimitText(MIMO_429)).toBe(true);
    expect(isRateLimitText(MIMO_TPM_429)).toBe(true); // rate_limit_error / rate_limited
    expect(isRateLimitText(CODEBUDDY_6004)).toBe(true);
    expect(isRateLimitText('"code":"429"')).toBe(true);
    expect(isRateLimitText("Rate limit exceeded")).toBe(true);
  });

  it("does not match channel-scope or unrelated errors", () => {
    expect(isRateLimitText(CHANNEL_11128)).toBe(false);
    expect(isRateLimitText("No active credentials for provider: x")).toBe(false);
    expect(isRateLimitText("")).toBe(false);
    expect(isRateLimitText(null)).toBe(false);
  });
});

describe("withRateLimitHint", () => {
  it("appends a Chinese actionable hint to the raw429 blob", () => {
    const out = withRateLimitHint(MIMO_429, "xiaomi-mimo");
    expect(out.startsWith(MIMO_429)).toBe(true);
    expect(out).toContain("\n\n提示：");
    expect(out).toContain("HTTP 429");
    expect(out).toContain("非账号异常");
    expect(out).toContain("按上游提示自动冷却");
    // Channel-specific note covers BOTH shapes: per-request and TPM.
    expect(out).toContain("小米 MiMo");
    expect(out).toContain("TPM");
  });

  it("handles a non-mapped provider without inventing a channel note", () => {
    const out = withRateLimitHint(CODEBUDDY_6004, "codebuddy-cn");
    expect(out).toContain("HTTP 429");
    expect(out).not.toContain("小米 MiMo");
  });

  it("passes non-rate-limit messages through byte-for-byte", () => {
    expect(withRateLimitHint(CHANNEL_11128, "codebuddy-cn")).toBe(CHANNEL_11128);
    expect(withRateLimitHint(undefined)).toBe(undefined);
    expect(withRateLimitHint("")).toBe("");
  });
});

describe("extractRetrySeconds", () => {
  it("parses the Chinese hint xiaomi-mimo actually sends", () => {
    expect(extractRetrySeconds("用户 每人 触发 TPM 限流（上限 5000000），请约 23 秒后重试")).toBe(23);
    expect(extractRetrySeconds("请约 21 秒后重试")).toBe(21);
    expect(extractRetrySeconds("已限流，30秒后重试")).toBe(30);
  });

  it("parses common English retry hints", () => {
    expect(extractRetrySeconds("please retry after 45 seconds")).toBe(45);
    expect(extractRetrySeconds("retry in 12s")).toBe(12);
    expect(extractRetrySeconds("try again in 7 seconds")).toBe(7);
  });

  it("returns null when there is no explicit hint (so backoff stays authoritative)", () => {
    expect(extractRetrySeconds("Too Many Requests")).toBe(null);
    expect(extractRetrySeconds("您的使用量已超出频率限制")).toBe(null);
    expect(extractRetrySeconds("")).toBe(null);
    expect(extractRetrySeconds(undefined)).toBe(null);
  });
});

describe("checkFallbackError honors the upstream wait", () => {
  it("uses the stated 23s instead of the 2s first backoff step", () => {
    const res = checkFallbackError(429, MIMO_TPM_429, 0);
    expect(res.shouldFallback).toBe(true);
    // Without the fix this was getQuotaCooldown(1) = 2000ms.
    expect(res.cooldownMs).toBe(23000);
    expect(res.newBackoffLevel).toBe(1);
  });

  it("keeps plain exponential backoff when the body states no wait", () => {
    expect(checkFallbackError(429, "slow down", 0).cooldownMs).toBe(2000);
    expect(checkFallbackError(429, "slow down", 1).cooldownMs).toBe(4000);
  });

  it("never lets an upstream hint exceed the 30min hard cap", () => {
    const huge = "please retry after 3600 seconds";
    expect(checkFallbackError(429, huge, 0).cooldownMs).toBe(30 * 60 * 1000);
  });

  it("leaves the channel-scope flag intact while changing only the cooldown", () => {
    // A rate-limit body must NOT be mistaken for a channel-scope error.
    expect(checkFallbackError(429, MIMO_TPM_429, 0).channelScope).toBe(false);
    expect(checkFallbackError(400, "unapproved channel").channelScope).toBe(true);
  });
});
