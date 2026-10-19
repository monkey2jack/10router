/**
 * deepseek-v4-1-flash (hyphen) capability alias.
 *
 * Resellers (e.g. Kenari) expose DeepSeek V4.1 Flash under the hyphenated id
 * "deepseek-v4-1-flash" instead of the dotted "deepseek-v4.1-flash". Only the
 * dotted id had a canonical entry, so the hyphen form fell through to the
 * *deepseek-v4* pattern, whose caps declare no vision — images were silently
 * stripped at the modality layer. The alias pins parity between both spellings.
 */
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("deepseek-v4-1-flash capability alias", () => {
  const hyphen = getCapabilitiesForModel("kenari", "deepseek-v4-1-flash");
  const dotted = getCapabilitiesForModel("kenari", "deepseek-v4.1-flash");

  it("reports vision:true for the hyphenated id", () => {
    expect(hyphen.vision).toBe(true);
  });

  it("matches the dotted id's capability row exactly", () => {
    expect(hyphen).toEqual(dotted);
  });

  it("does not fall through to the *deepseek-v4* pattern defaults", () => {
    expect(hyphen.reasoning).toBe(true);
    expect(hyphen.thinkingFormat).toBe("deepseek");
    expect(hyphen.contextWindow).toBe(1000000);
    expect(hyphen.maxOutput).toBe(384000);
  });

  it("resolves through vendor-prefixed ids too", () => {
    expect(getCapabilitiesForModel("kenari", "kenari/deepseek-v4-1-flash").vision).toBe(true);
  });
});
