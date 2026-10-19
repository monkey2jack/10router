/**
 * ModelSelectModal live catalog — zed joins cursor.
 *
 * Only cursor used to fetch its per-account catalog via
 * /api/providers/[connection]/models. zed's backend registry resolves its
 * catalog live (modelsUrl; the static list is intentionally empty +
 * passthroughModels), but the Combo picker never fetched it, so zed had no
 * selectable models. Source guards pin the provider-general wiring: the
 * constant, the per-provider connection-id map, and the group-builder lookup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const abs = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const src = readFileSync(abs("src/shared/components/ModelSelectModal.js"), "utf8");

describe("ModelSelectModal LIVE_CATALOG_PROVIDERS", () => {
  it("includes zed next to cursor", () => {
    const match = src.match(/const LIVE_CATALOG_PROVIDERS\s*=\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain('"cursor"');
    expect(match[1]).toContain('"zed"');
  });

  it("collects per-provider connection ids for every live catalog provider", () => {
    expect(src).toContain("liveConnectionIdsByProvider");
    expect(src).toMatch(/LIVE_CATALOG_PROVIDERS\.map\(async \(providerId\)|LIVE_CATALOG_PROVIDERS\.map\(/);
  });

  it("feeds live models into the group builder with static catalog as fallback", () => {
    expect(src).toContain("liveCatalogModels[providerId]");
    expect(src).toContain("getModelsByProviderId(providerId)");
  });

  it("no longer keys the live path on a cursor-only state", () => {
    expect(src).not.toContain("cursorModels");
  });
});
