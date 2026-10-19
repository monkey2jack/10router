// 回归锁：出站代理启用时 NO_PROXY 必须并入回环。
//
// 2026-09-27 实锤事故：outboundProxyEnabled=true 且 outboundNoProxy 为空时，
// 服务器内的自环 fetch（模型测试 ping → 127.0.0.1:20128）被送进出站代理，
// 代理在**自己所在机器**上解析 127.0.0.1 —— 落到 NAS 上另一台 9router 实例
// (0.5.91)，拿本机 key 在人家库里验证 → 全供应商模型测试统一 401
// "Invalid API key"（mihomo /connections 抓到每次测试都有 127.0.0.1:20128 现行）。
// 两个镜像（layout 侧 + standalone 侧）都必须合入 loopback。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyOutboundProxyEnv } from "../../src/lib/network/outboundProxy.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the mirrored sources from THIS file, not process.cwd(): the suite
// runs from tests/ (CI) and from the repo root alike, and cwd-based paths
// break in one of the two — which is what kept this file's mirror test red in
// the baseline.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const saved = {};
const KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NINE_ROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_URL", "NINE_ROUTER_NO_PROXY"];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("applyOutboundProxyEnv: loopback always bypasses the outbound proxy", () => {
  it("merges 127.0.0.1/localhost/::1 into NO_PROXY when the proxy is enabled", () => {
    applyOutboundProxyEnv({ outboundProxyEnabled: true, outboundProxyUrl: "http://192.168.31.101:7890", outboundNoProxy: "" });
    expect(process.env.HTTP_PROXY).toBe("http://192.168.31.101:7890/");
    const entries = process.env.NO_PROXY.split(",").map((s) => s.trim());
    expect(entries).toEqual(expect.arrayContaining(["127.0.0.1", "localhost", "::1"]));
    expect(process.env.NINE_ROUTER_NO_PROXY).toBe(process.env.NO_PROXY);
  });

  it("keeps the user's own noProxy entries additively", () => {
    applyOutboundProxyEnv({ outboundProxyEnabled: true, outboundProxyUrl: "http://192.168.31.101:7890", outboundNoProxy: "example.com,.internal" });
    const entries = process.env.NO_PROXY.split(",").map((s) => s.trim());
    expect(entries).toEqual(expect.arrayContaining(["example.com", ".internal", "127.0.0.1", "localhost", "::1"]));
  });

  it("does not set NO_PROXY when the proxy is disabled", () => {
    applyOutboundProxyEnv({ outboundProxyEnabled: false });
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.NO_PROXY).toBeUndefined();
  });

  it("the standalone mirror applies the same loopback merge (kept in sync)", () => {
    const src = readFileSync(path.join(repoRoot, "src/lib/network/outboundProxyStandalone.js"), "utf8");
    expect(src).toContain('"127.0.0.1", "localhost", "::1"');
    const layout = readFileSync(path.join(repoRoot, "src/lib/network/outboundProxy.js"), "utf8");
    expect(layout).toContain('"127.0.0.1", "localhost", "::1"');
  });
});
