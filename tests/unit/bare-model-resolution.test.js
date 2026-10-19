/**
 * Bare (unprefixed) model-name resolution at the gateway (#34).
 *
 * /v1/models only advertises provider-prefixed ids, so a bare name that
 * matches no alias/combo is a client error. The chat path now opts out of
 * the name-prefix inference (`inferFallback: false`) that used to route
 * e.g. "deepseek-v4.1-flash" to whatever provider shared the prefix and
 * fail there with a misleading "No active credentials" 404. The inference
 * itself stays for the surfaces where bare names are the OpenAI-SDK
 * convention (/v1/audio, /v1/images, /v1/embeddings).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(async () => ({ "my-alias": "cc/claude-sonnet-5" })),
  getComboByName: vi.fn(async (name) => (name === "my-combo" ? { models: ["cc/claude-sonnet-5"] } : null)),
  getProviderNodes: vi.fn(async () => []),
}));

import { getModelInfo } from "../../src/sse/services/model.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

describe("getModelInfo: chat path opts out of prefix inference", () => {
  it("unmatched bare name resolves to provider null (#34)", async () => {
    const info = await getModelInfo("totally-made-up-xyz", { inferFallback: false });
    expect(info).toEqual({ provider: null, model: "totally-made-up-xyz" });
  });

  it("the #34 repro no longer guesses openrouter for bare deepseek", async () => {
    const info = await getModelInfo("deepseek-v4.1-flash", { inferFallback: false });
    expect(info.provider).toBeNull();
    expect(info.model).toBe("deepseek-v4.1-flash");
  });

  it("builtin aliases still resolve with inference off", async () => {
    const info = await getModelInfo("grok-build", { inferFallback: false });
    expect(info).toEqual({ provider: "grok-cli", model: "grok-build" });
  });

  it("user aliases still resolve with inference off (alias normalized to provider id)", async () => {
    const info = await getModelInfo("my-alias", { inferFallback: false });
    expect(info).toEqual({ provider: "claude", model: "claude-sonnet-5" });
  });

  it("combo names still return a null provider (combo handling upstream)", async () => {
    const info = await getModelInfo("my-combo", { inferFallback: false });
    expect(info).toEqual({ provider: null, model: "my-combo" });
  });

  it("prefixed names are untouched (alias prefix normalized as before)", async () => {
    const info = await getModelInfo("cc/claude-sonnet-5", { inferFallback: false });
    expect(info.provider).toBe("claude");
    expect(info.model).toBe("claude-sonnet-5");
  });
});

describe("getModelInfo: inference stays available where bare names are the convention", () => {
  it("default (media surfaces) still infers openai for an unmatched bare name", async () => {
    const info = await getModelInfo("totally-made-up-xyz");
    expect(info.provider).toBe("openai");
  });

  it("getModelInfoCore keeps its inference fallback (open-sse engine surface)", async () => {
    const info = await getModelInfoCore("deepseek-v4.1-flash", {});
    expect(info.provider).toBe("openrouter");
  });
});
