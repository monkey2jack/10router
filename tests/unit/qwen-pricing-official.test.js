/**
 * Qwen official pricing — pinned against the wildcard trap.
 *
 * Before this batch every new Qwen flagship silently resolved through the
 * generic `qwen*` pattern, which carries qwen3-coder-flash's rate (0.5/2).
 * Estimated cost for qwen3.8-max traffic was therefore wrong by 4x input /
 * 3x output — invisible, because a number showed up. Values below are the
 * Alibaba Cloud Model Studio international (Singapore) USD list prices
 * fetched 2026-09-24 from the "Model inference pricing" doc.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_PRICING, PATTERN_PRICING, PROVIDER_PRICING, getPricingForModel, matchPattern } from "open-sse/providers/pricing.js";

// The wildcard value these models must NOT be priced by.
const WILDCARD = PATTERN_PRICING.find((p) => p.pattern === "qwen*")?.pricing
  || { input: 0.5, output: 2.0 };

describe("qwen official exact pricing", () => {
  const official = {
    "qwen3.8-max":            { input: 2.00, output: 6.00 },
    "qwen3.8-max-0902":       { input: 2.00, output: 6.00 },
    "qwen3.7-max":            { input: 2.50, output: 7.50 },
    "qwen3.7-plus":           { input: 0.40, output: 1.60 },
    "qwen3.6-plus":           { input: 0.50, output: 3.00 },
    "qwen3.5-plus":           { input: 0.40, output: 2.40 },
    "qwen3.8-flash":          { input: 0.15, output: 0.47 },
    "qwen3.6-flash":          { input: 0.25, output: 1.50 },
    "qwen3.5-flash":          { input: 0.10, output: 0.40 },
    "qwen-flash":             { input: 0.05, output: 0.40 },
  };

  for (const [id, want] of Object.entries(official)) {
    it(`${id} resolves at the official rate, not the qwen* wildcard`, () => {
      expect(MODEL_PRICING[id], `${id} missing exact entry`).toMatchObject({ input: want.input, output: want.output });
      const viaProvider = getPricingForModel("aliyun", id);
      expect(viaProvider).toMatchObject({ input: want.input, output: want.output });
      // Guard the actual bug: it must not be the wildcard's value.
      expect(viaProvider.input === WILDCARD.input && viaProvider.output === WILDCARD.output,
        `${id} would price identical to the qwen* fallback`).toBe(false);
    });
  }

  it("versioned aliases the registry lists resolve too (no silent wildcard)", () => {
    for (const id of ["qwen3.7-max-2026-05-20"]) {
      expect(MODEL_PRICING[id], id).toBeDefined();
    }
  });

  it("mimo-v2.6-pro-claude carries the mimo-v2.6-pro rate (same upstream)", () => {
    const { getPricingForModel: g } = { getPricingForModel };
    expect(g("xiaomi-tokenplan", "mimo-v2.6-pro-claude")).toEqual(g("xiaomi-tokenplan", "mimo-v2.6-pro"));
    expect(g("xiaomi-tokenplan", "mimo-v2.6-pro").input).toBe(0.435);
  });
});

describe("pricing coverage audit tool", () => {
  const script = readFileSync(
    new URL("../../scripts/audit-pricing.mjs", import.meta.url), "utf8",
  );

  it("ships offline with the real resolver and a --check gate", () => {
    expect(script).toContain("getPricingForModel");
    expect(script).toContain("--check");
    // The exemptions must stay commented rationales, never a silent blanket.
    expect(script).toContain("credit plans");
    expect(script).toContain("freeTier");
  });

  it("never re-lists the qwen flagships it was written to catch", () => {
    // regression: these were silently wildcard-priced when the tool was built
    for (const id of ["qwen3.8-max", "qwen3.8-flash", "qwen3.6-plus"]) {
      expect(MODEL_PRICING[id], id).toBeDefined();
    }
  });
});
