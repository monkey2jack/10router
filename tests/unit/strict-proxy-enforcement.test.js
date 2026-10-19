import { describe, it, expect, vi, beforeEach } from "vitest";

// "严格代理"失效复现:指定了 strict 代理池,但池不可用(停用 / URL 为空)时,
// resolveConnectionProxyConfig 把池信息连同 strictProxy 一起丢掉,落到
// legacy/none 分支,而那一层只认 providerSpecificData 上的 strictProxy —
// 于是请求被静默直连,真实 IP 泄漏。修复分两层:
//
// 1. resolveConnectionProxyConfig:池不可用也要把池自己的 strict 标记透传出去。
// 2. proxyAwareFetch:有代理意图(strictProxy + pool/enabled/url)却一个代理都
//    没解析出来时,拒绝请求而不是落到最后的直连分支。
vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

const { getProxyPoolById } = await import("@/models");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

describe("strict 代理池在池不可用时仍保住 strictProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("池停用:isActive=false 仍透传 strictProxy", async () => {
    getProxyPoolById.mockResolvedValueOnce({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(cfg.source).toBe("none");
    expect(cfg.strictProxy).toBe(true);
  });

  it("池 URL 为空:仍透传 strictProxy", async () => {
    getProxyPoolById.mockResolvedValueOnce({
      id: "p2", isActive: true, proxyUrl: "", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p2" });
    expect(cfg.source).toBe("none");
    expect(cfg.strictProxy).toBe(true);
  });

  it("池不存在(getProxyPoolById 返回 null):strictProxy 为 false,不臆造意图", async () => {
    getProxyPoolById.mockResolvedValueOnce(null);
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "ghost" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("非 strict 池停用时仍是 strictProxy=false", async () => {
    getProxyPoolById.mockResolvedValueOnce({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p3" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("未指定池时 strictProxy 仍来自 legacy 字段(老行为不变)", async () => {
    const cfg = await resolveConnectionProxyConfig({ strictProxy: true });
    expect(cfg.source).toBe("none");
    expect(cfg.strictProxy).toBe(true);
  });
});

describe("strictProxy + 代理意图但零解析结果时拒绝直连", () => {
  it("指定了池但没解析出 URL:抛 strictProxy 错误而不是静默直连", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("enabled 但 URL 为空:同样拒绝", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { enabled: true, url: "", strictProxy: true }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("connectionProxyEnabled + 空 connectionProxyUrl:同样拒绝", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, {
        connectionProxyEnabled: true, connectionProxyUrl: "", strictProxy: true,
      }),
    ).rejects.toThrow(/strictProxy/);
  });

  it("strictProxy 但完全没配置代理:不拒绝(意图门槛)", async () => {
    // Qoder 执行器把 strictProxy 用作"代理失败时不要直连重放本请求",而不是
    // "必须挂代理"——完全没配代理时必须照常到达网络层。这里用环回不可用端口,
    // 校验拒绝信息不是 strictProxy 守卫(快速 ECONNREFUSED 即可,不关心具体错误)。
    await expect(
      proxyAwareFetch("http://127.0.0.1:1/ping", {}, { strictProxy: true }),
    ).rejects.not.toThrow(/strictProxy/);
  });

  it("未开 strictProxy 时不被新守卫拦截", async () => {
    await expect(
      proxyAwareFetch("http://127.0.0.1:1/ping", {}, { proxyPoolId: "p9", strictProxy: false }),
    ).rejects.not.toThrow(/strictProxy/);
  });
});
