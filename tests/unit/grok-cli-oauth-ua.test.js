/**
 * Grok CLI 身份指纹（上游 cli-chat-proxy 对 <1.0.13 的 Grok CLI 一律 HTTP 426）：
 * - GROK_CLI_VERSION 不得低于 1.0.13；
 * - OAuth device-flow / 探测请求（grok-pager 身份）的 UA 与 x-grok-client-version
 *   必须与 open-sse/config/grokCli.js 同一份常量保持同步 —— 之前
 *   src/lib/oauth/providers/grok-cli.js 硬编码 0.2.93 已被 426 墙掉过一次。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GROK_CLI_VERSION,
  GROK_CLI_USER_AGENT,
  GROK_CLI_PAGER_USER_AGENT,
} from "../../open-sse/config/grokCli.js";
import grokCli from "../../src/lib/oauth/providers/grok-cli.js";

// 简易 semver 比较 [major, minor, patch]
const semverOf = (v) => v.split(".").map(Number);

describe("grok-cli 身份指纹 (HTTP 426 fix)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("GROK_CLI_VERSION 不低于 cli-chat-proxy 的最低要求 1.0.13", () => {
    const current = semverOf(GROK_CLI_VERSION);
    const minimum = semverOf("1.0.13");
    expect(current.every((n) => Number.isInteger(n))).toBe(true);
    for (let i = 0; i < 3; i++) {
      if (current[i] !== minimum[i]) {
        expect(current[i]).toBeGreaterThan(minimum[i]);
        return;
      }
    }
  });

  it("两种 UA 都由同一个 GROK_CLI_VERSION 派生", () => {
    expect(GROK_CLI_USER_AGENT).toBe(`grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`);
    expect(GROK_CLI_PAGER_USER_AGENT).toBe(
      `grok-pager/${GROK_CLI_VERSION} grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`
    );
  });

  it("requestDeviceCode 带官方 grok-pager UA", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ device_code: "dc" }),
    });

    await grokCli.requestDeviceCode({
      deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
      clientId: "cid",
      scope: "openid",
      referrer: "grok-build",
    });

    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toBe(GROK_CLI_PAGER_USER_AGENT);
    expect(headers["User-Agent"]).toContain(`grok-pager/${GROK_CLI_VERSION}`);
  });

  it("pollToken 带官方 grok-pager UA", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "at" }),
    });

    await grokCli.pollToken(
      { tokenUrl: "https://auth.x.ai/oauth2/token", clientId: "cid" },
      "dc"
    );

    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toBe(GROK_CLI_PAGER_USER_AGENT);
  });

  it("postExchange 探测 /v1/user 带 pager UA + 当前版本 x-grok-client-version", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: "u@example.com" }),
    });

    await grokCli.postExchange({ access_token: "at" });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://cli-chat-proxy.grok.com/v1/user");
    expect(init.headers["User-Agent"]).toBe(GROK_CLI_PAGER_USER_AGENT);
    expect(init.headers["x-grok-client-version"]).toBe(GROK_CLI_VERSION);
    expect(init.headers["x-xai-token-auth"]).toBe("xai-grok-cli");
  });
});
