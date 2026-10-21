import { describe, it, expect } from "vitest";

// Issue #76: 出海代理偶发建连超时后,proxyFetch 回退直连,而被墙端点静默丢包
// TCP 握手,裸连无上限地死等(实测 788s),堵死上层多账号/Combo 顺位接力。
//
// 修复三件套:
// 1. 直连兜底(代理失败后的 originalFetch)带 directFallbackTimeoutMs 上限;
// 2. MITM bypass 裸 socket(createBypassRequest)接 caller signal + 连接超时;
// 3. 不可直连渠道(antigravity / gemini-cli)registry 默认 strictProxy=true,
//    代理失败立即抛错进入账号顺位接力,连接级显式设置优先于渠道默认。

// 在 import proxyFetch 之前挂 mock fetch —— proxyFetch 在模块加载时捕获
// globalThis.fetch 作为 originalFetch。mock 语义:带 dispatcher(代理分支)
// 立即失败,模拟"代理偶发建连失败";直连分支永久挂起直到 signal abort,
// 模拟被墙端点静默丢包的 TCP 握手——修复前这正是无上限死等的源头。
let capturedSignal = null;
process.env.DIRECT_FALLBACK_TIMEOUT_MS = "300";
globalThis.fetch = (url, options = {}) => {
  if (options.dispatcher) return Promise.reject(new Error("proxy connect failed (mock)"));
  return new Promise((_, reject) => {
    const signal = options.signal;
    if (!signal) return; // no signal = hang forever (the pre-fix behavior)
    capturedSignal = signal;
    if (signal.aborted) return reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
};

const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { PROVIDERS } = await import("../../open-sse/providers/index.js");

describe("Issue #76: 代理失败后的直连兜底必须有超时上限", () => {
  it("无 signal 的直连回退在 directFallbackTimeoutMs 后中止,而非永久挂起", async () => {
    // 127.0.0.1:1 的代理立刻 ECONNREFUSED(模拟"代理偶发超时后的失败"),
    // 随后直连落到挂起的 fetch —— 修复前这里会挂到天荒地老。
    const t0 = Date.now();
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", { method: "POST" }, {
        enabled: true, url: "http://127.0.0.1:1",
      }),
    ).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15000);

  it("直连回退注入的 signal 真正传给了底层 fetch(可中止)", async () => {
    capturedSignal = null;
    proxyAwareFetch("https://api.example.com/v1/chat", { method: "POST" }, {
      enabled: true, url: "http://127.0.0.1:1",
    }).catch(() => { });
    // 给 proxyAwareFetch 一点时间走到直连分支,再越过 300ms 兜底超时
    await new Promise((r) => setTimeout(r, 450));
    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal.aborted).toBe(true); // 300ms 超时已把 signal 烧成 aborted
  }, 15000);
});

describe("Issue #76: MITM bypass 渠道的 strictProxy 快速失败", () => {
  it("cloudcode-pa(Google cloudcode)代理失败 + strictProxy:抛错而非直连死等", async () => {
    const t0 = Date.now();
    await expect(
      proxyAwareFetch("https://daily-cloudcode-pa.googleapis.com/v1internal:x", { method: "POST" }, {
        enabled: true, url: "http://127.0.0.1:1", strictProxy: true,
      }),
    ).rejects.toThrow(/strictProxy/);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15000);
});

describe("Issue #76: 不可直连渠道 registry 默认 strictProxy", () => {
  it("antigravity 与 gemini-cli 默认 strictProxy=true", () => {
    expect(PROVIDERS.antigravity?.strictProxy).toBe(true);
    expect(PROVIDERS["gemini-cli"]?.strictProxy).toBe(true);
  });

  it("普通可直连渠道不带 strictProxy 默认", () => {
    // 抽查一个 OpenAI 兼容渠道:没有渠道默认,行为与修复前一致
    expect(PROVIDERS.anthropic?.strictProxy).toBeUndefined();
  });
});

describe("Issue #76 — proxyFetch 读取的 MEMORY_CONFIG 键必须存在", () => {
  // createBypassRequest 曾把建连超时写成不存在的 mitmBypassConnectTimeoutMs:
  // setTimeout(fn, undefined) 约 1ms 即触发,所有 MITM bypass 请求被秒杀。
  // 拼错的键不会报错,只能靠逐键核对。
  it("每个 MEMORY_CONFIG.<key> 引用都有定义且为正数", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    const src = readFileSync(fileURLToPath(new URL("../../open-sse/utils/proxyFetch.js", import.meta.url)), "utf8");
    const keys = [...new Set([...src.matchAll(/MEMORY_CONFIG\.(\w+)/g)].map((m) => m[1]))];
    expect(keys).toContain("directFallbackTimeoutMs");
    for (const k of keys) {
      expect(MEMORY_CONFIG[k], `MEMORY_CONFIG.${k}`).toBeGreaterThan(0);
    }
  });
});
