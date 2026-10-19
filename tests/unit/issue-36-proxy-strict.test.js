import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyPoolUrlError, validateProxyUrl } from "../../src/lib/network/outboundProxy.js";
import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import { encryptSecret } from "../../src/lib/db/crypto/credentialCipher.js";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

describe("Issue #36: Proxy URL validation and strictProxy propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("proxyPoolUrlError save-time validation", () => {
    it("accepts standard valid proxy URLs", () => {
      expect(proxyPoolUrlError("http://127.0.0.1:7890")).toBeNull();
      expect(proxyPoolUrlError("https://proxy.example.com:8443")).toBeNull();
      expect(proxyPoolUrlError("socks5://user:pass@10.0.0.1:1080")).toBeNull();
    });

    it("rejects empty proxy URL", () => {
      expect(proxyPoolUrlError("")).toContain("Proxy URL is required");
      expect(proxyPoolUrlError("   ")).toContain("Proxy URL is required");
    });

    it("specifically flags enc:v1: pasted ciphertext", () => {
      const err = proxyPoolUrlError("enc:v1:AAAA:BBBB:CCCC");
      expect(err).toContain("looks like an encrypted credential");
      expect(err).toContain("enc:v1:");
    });

    it("specifically flags enc:// unsupported protocol", () => {
      const err = proxyPoolUrlError("enc://1.2.3.4:7890");
      expect(err).toContain("enc:// is not a supported proxy protocol");
    });

    it("rejects invalid schemes like ftp, javascript, gopher", () => {
      expect(proxyPoolUrlError("ftp://1.2.3.4:21")).toContain("protocol must be one of");
      expect(proxyPoolUrlError("javascript:alert(1)")).toContain("protocol must be one of");
    });

    it("accepts the scheme-less forms the runtime normalizes to http", () => {
      // normalizeProxyUrl prefixes http:// on anything without a scheme, so a
      // credentialed "user:pass@host:8080" (the "word:" before @ is userinfo,
      // not a scheme) must pass save-time exactly as it would run.
      expect(proxyPoolUrlError("user:pass@host:8080")).toBeNull();
      expect(proxyPoolUrlError("user:pass@10.0.0.1")).toBeNull();
      expect(proxyPoolUrlError("127.0.0.1:7890")).toBeNull();
      expect(proxyPoolUrlError("localhost:7890")).toBeNull();
    });
  });

  describe("resolveConnectionProxyConfig with strictProxy and unwrapProxyUrl", () => {
    it("propagates strictProxy=true from proxy pool", async () => {
      const { getProxyPoolById } = await import("@/models");
      getProxyPoolById.mockResolvedValueOnce({
        id: "pool_1",
        name: "Test Pool",
        proxyUrl: "http://127.0.0.1:7890",
        isActive: true,
        strictProxy: true,
        type: "http",
      });

      const config = await resolveConnectionProxyConfig({ proxyPoolId: "pool_1" });
      expect(config.source).toBe("pool");
      expect(config.strictProxy).toBe(true);
      expect(config.connectionProxyUrl).toBe("http://127.0.0.1:7890");
    });

    it("propagates strictProxy from legacy connection settings", async () => {
      const config = await resolveConnectionProxyConfig({
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://127.0.0.1:7890",
        strictProxy: true,
      });
      expect(config.source).toBe("legacy");
      expect(config.strictProxy).toBe(true);
    });

    it("transparently unwraps encrypted enc:v1: proxyUrl in proxy pool", async () => {
      const { getProxyPoolById } = await import("@/models");
      const plainUrl = "http://10.0.0.1:8888";
      const cipher = encryptSecret(plainUrl);

      getProxyPoolById.mockResolvedValueOnce({
        id: "pool_encrypted",
        proxyUrl: cipher,
        isActive: true,
        strictProxy: false,
        type: "http",
      });

      const config = await resolveConnectionProxyConfig({ proxyPoolId: "pool_encrypted" });
      expect(config.source).toBe("pool");
      expect(config.connectionProxyUrl).toBe(plainUrl);
    });
  });
});
