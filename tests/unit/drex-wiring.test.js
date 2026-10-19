// Drex — System One decision provider wiring contract: systemone-only catalog
// (no chat transport, per the search-provider precedent), PROVIDER_MEDIA
// config, registry/alias registration. No usage card — the API has exactly two
// endpoints (POST /v1/systemone + GET /v1/models) and no quota API.
import { describe, expect, it } from "vitest";

import drex from "open-sse/providers/registry/drex.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

describe("registry contract: drex", () => {
  it("is an apikey, systemone-only provider with an invite key link", () => {
    expect(drex.category).toBe("apikey");
    expect(drex.serviceKinds).toEqual(["systemone"]);
    expect(drex.transport).toBeUndefined();
    expect(drex.display.notice.apiKeyUrl).toBe("https://drex.nace.ai/invite/tnzgt5vr");
  });

  it("advertises the live decision-model catalog, all on the systemone kind", () => {
    expect(drex.models.map((m) => m.id)).toEqual([
      "drex-v1.0",
      "drex-v1.1",
      "drex-v1.5",
      "drex-latest",
    ]);
    expect(drex.models.every((m) => m.kind === "systemone")).toBe(true);
  });

  it("is registered with a systemoneConfig and resolvable model ids", () => {
    expect(REGISTRY.some((e) => e.id === "drex")).toBe(true);
    expect(PROVIDER_MEDIA.drex?.systemoneConfig?.baseUrl).toBe(
      "https://drex.nace.ai/v1/systemone",
    );
    expect(PROVIDER_MODELS.drex.map((m) => m.id)).toContain("drex-v1.5");
  });

  it("opts out of the usage card (no quota API exists)", () => {
    expect(drex.features?.usage).toBeFalsy();
    expect(drex.features?.usageApikey).toBeFalsy();
  });
});
