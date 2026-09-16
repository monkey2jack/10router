import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearClineModelsCache,
  resolveClineModels,
} from "../../open-sse/services/clineModels.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FEED = {
  recommended: [{ id: "openai/gpt-6-astra", name: "gpt-6-astra" }],
  free: [
    { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek-v4.1-Flash" },
    { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
  ],
  clinePass: [{ id: "cline-pass/glm-5.2", name: "cline-pass/glm-5.2" }],
};

const CREDS = (over = {}) => ({
  accessToken: "tok-123",
  apiKey: null,
  email: "user@example.com",
  refreshToken: null,
  providerSpecificData: {},
  ...over,
});

describe("resolveClineModels", () => {
  beforeEach(() => {
    clearClineModelsCache();
    vi.clearAllMocks();
  });

  it("returns only the free shelf, ignoring recommended and clinePass", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(FEED));
    const result = await resolveClineModels(CREDS(), { fetchFn });
    expect(result).toEqual({
      models: [
        { id: "cline-free/deepseek-v4.1-flash", name: "Deepseek-v4.1-Flash" },
        { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
      ],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain("recommended-models");
  });

  it("works without credentials (public catalog endpoint)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(FEED));
    const result = await resolveClineModels({}, { fetchFn });
    expect(result?.models).toHaveLength(2);
    const headers = fetchFn.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("fails open with null on non-200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(resolveClineModels(CREDS(), { fetchFn })).resolves.toBeNull();
  });

  it("fails open with null on empty free list", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ free: [] }));
    await expect(resolveClineModels(CREDS(), { fetchFn })).resolves.toBeNull();
  });

  it("fails open with null on network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(resolveClineModels(CREDS(), { fetchFn })).resolves.toBeNull();
  });

  it("caches per credential within TTL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(FEED));
    await resolveClineModels(CREDS(), { fetchFn });
    await resolveClineModels(CREDS(), { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
