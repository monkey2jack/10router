// Guards the refactored REFRESH_HANDLERS dispatch: null-guards + the two different defaults.
import { describe, it, expect } from "vitest";

const load = () => import("../../open-sse/services/tokenRefresh.js");

describe("tokenRefresh dispatch", () => {
  it("getAccessToken returns null for missing/invalid refreshToken", async () => {
    const mod = await load();
    expect(await mod.getAccessToken("claude", {}, null)).toBeNull();
    expect(await mod.getAccessToken("claude", { refreshToken: 123 }, null)).toBeNull();
  });

  it("getAccessToken default: unsupported provider → null", async () => {
    const mod = await load();
    expect(await mod.getAccessToken("totally-unknown", { refreshToken: "x" }, null)).toBeNull();
  });

  it("refreshTokenByProvider returns null without refreshToken", async () => {
    const mod = await load();
    expect(await mod.refreshTokenByProvider("claude", {}, null)).toBeNull();
  });

  it("dispatches cline and clinepass via REFRESH_HANDLERS", async () => {
    const mod = await load();
    expect(typeof mod.refreshClineToken).toBe("function");
    expect(await mod.getAccessToken("cline", {}, null)).toBeNull();
    expect(await mod.getAccessToken("clinepass", {}, null)).toBeNull();
    expect(await mod.refreshTokenByProvider("cline", {}, null)).toBeNull();
    expect(await mod.refreshTokenByProvider("clinepass", {}, null)).toBeNull();
  });
});
