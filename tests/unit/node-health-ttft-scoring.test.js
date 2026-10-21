// Node health latency axis scores TTFT, not total latency (2026-10-20).
//
// Total latency measures the WHOLE request. For agent workloads that is
// dominated by generation time, so a Mercury-class diffusion model at
// ~1000 tok/s streaming for a minute scored 20/100 on the latency axis —
// the same seconds its (perfect-100) speed axis already counted. Long-output
// fast models were structurally capped at ~83 health and sorted below slower
// nodes. TTFT is the node's own responsiveness; output length is the
// request's size, not the node's health.
import { describe, it, expect } from "vitest";

const { __scoreInternals } = await import("@/lib/db/repos/usageRepo.js");
const { ttftScoreFromMs, latencyScoreFromMs, speedScoreFromTps, computeScore } = __scoreInternals;

describe("ttftScoreFromMs", () => {
  it("scores fast first tokens at the top of the scale", () => {
    expect(ttftScoreFromMs(120)).toBe(100);   // Mercury-class / well-provisioned edge
    expect(ttftScoreFromMs(399)).toBe(100);   // threshold is exclusive: <400
    expect(ttftScoreFromMs(700)).toBe(80);
    expect(ttftScoreFromMs(1200)).toBe(60);
    expect(ttftScoreFromMs(2500)).toBe(40);
    expect(ttftScoreFromMs(5000)).toBe(20);
  });

  it("returns null without a sample so the fallback can engage", () => {
    expect(ttftScoreFromMs(null)).toBeNull();
    expect(ttftScoreFromMs(undefined)).toBeNull();
  });
});

describe("latency axis: TTFT preferred, total as fallback", () => {
  it("a 60s-generation 1000 tok/s model scores high on TTFT, was capped on total", () => {
    // Mercury profile: TTFT 300ms, but total latency 61s (generation-bound).
    const viaTtft = computeScore(98, ttftScoreFromMs(300), speedScoreFromTps(983));
    const viaTotal = computeScore(98, latencyScoreFromMs(61000), speedScoreFromTps(983));
    expect(viaTtft).toBeGreaterThanOrEqual(98);      // TTFT reflects the node
    expect(viaTotal).toBeLessThanOrEqual(84);        // old behaviour capped it
  });

  it("falls back to total latency when the row has no ttft samples", () => {
    expect(ttftScoreFromMs(null) ?? latencyScoreFromMs(8000)).toBe(60);
  });

  it("a genuinely slow first token still scores low", () => {
    expect(computeScore(98, ttftScoreFromMs(6000), speedScoreFromTps(20))).toBeLessThanOrEqual(80);
  });
});
