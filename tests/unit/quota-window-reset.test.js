// 回归：Antigravity 429 RESOURCE_EXHAUSTED（个人 5h 窗口额度用尽）必须按上游
// 给出的真实重置时间（quotaResetDelay / retryDelay / quotaResetTimeStamp）冷却，
// 而不是被当成普通限流压进 30min 封顶的指数退避（用户看到误导性的
// "reset after 1m 4s"，随后网关对冷却中的账号反复空打）。2026-09-27 实测 payload。
import { describe, expect, it } from "vitest";
import {
  checkFallbackError,
  withRateLimitHint,
  extractQuotaResetMs,
  googleDurationToSeconds,
} from "../../open-sse/services/accountFallback.js";

const AG_429_PAYLOAD = JSON.stringify({
  error: {
    code: 429,
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h32m30s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          model: "claude-opus-4-6-thinking",
          quotaResetDelay: "4h32m30.523936355s",
          quotaResetTimeStamp: new Date(Date.now() + 4.5 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          uiMessage: "true",
        },
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "16350.523936355s",
      },
    ],
  },
});

describe("googleDurationToSeconds", () => {
  it("parses h/m/s with fractional seconds", () => {
    expect(googleDurationToSeconds("4h32m30.523936355s")).toBe(16351);
    expect(googleDurationToSeconds("16350.523936355s")).toBe(16351);
    expect(googleDurationToSeconds("45s")).toBe(45);
  });

  it("returns null on junk", () => {
    expect(googleDurationToSeconds("")).toBeNull();
    expect(googleDurationToSeconds("abc")).toBeNull();
  });
});

describe("extractQuotaResetMs", () => {
  it("prefers quotaResetDelay from the JSON payload", () => {
    const ms = extractQuotaResetMs(AG_429_PAYLOAD);
    expect(ms).toBeGreaterThan(16300 * 1000);
    expect(ms).toBeLessThan(16400 * 1000);
  });

  it("falls back to quotaResetTimeStamp when no delay field", () => {
    const ms = extractQuotaResetMs(`{"quotaResetTimeStamp":"${new Date(Date.now() + 3600 * 1000).toISOString()}"}`);
    expect(ms).toBeGreaterThan(3500 * 1000);
  });

  it("parses the human 'Resets in 4h32m30s.' message form", () => {
    const ms = extractQuotaResetMs("Individual quota reached. Resets in 4h32m30s.");
    expect(ms).toBeGreaterThan(16300 * 1000);
  });

  it("returns null for plain rate-limit text", () => {
    expect(extractQuotaResetMs("Too Many Requests")).toBeNull();
    expect(extractQuotaResetMs("请约 23 秒后重试")).toBeNull();
  });
});

describe("checkFallbackError honors the quota window", () => {
  it("429 quota payload cools the account ~4h32m (beyond the 30min hint cap)", () => {
    const r = checkFallbackError(429, AG_429_PAYLOAD, 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(30 * 60 * 1000);
    expect(r.cooldownMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(r.cooldownMs).toBeGreaterThan(16300 * 1000);
  });
});

describe("withRateLimitHint quota branch", () => {
  it("quota payload gets the exhaustion wording with a reset clock", () => {
    const out = withRateLimitHint(`[antigravity/claude-opus-4-6-thinking] [429]: ${AG_429_PAYLOAD}`);
    expect(out).toContain("额度已用尽");
    expect(out).toContain("自动恢复");
    expect(out).not.toContain("稍候重试。");
  });

  it("plain TPM rate limit keeps the generic wording", () => {
    const out = withRateLimitHint("[xiaomi-mimo/mimo-x] [429]: 用户 每人 触发 TPM 限流（上限 5000000）", "xiaomi-mimo");
    expect(out).toContain("上游触发了限流");
    expect(out).not.toContain("额度已用尽");
  });
});
