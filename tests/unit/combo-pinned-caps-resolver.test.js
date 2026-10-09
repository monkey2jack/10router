import { describe, expect, it } from "vitest";

import { aggregateComboCapabilities } from "../../open-sse/providers/capabilities.js";

// /v1/models passes the dashboard-pinned caps as resolveCaps. A member's pinned
// window must reach the combo aggregate (ctx = min over members).
describe("combo aggregate honors pinned member caps", () => {
  const pinned = { "tokenharbor/claude-haiku-5.5:free": { contextWindow: 1_000_000, maxOutput: 128_000 } };
  const resolver = (fullId) => pinned[fullId] ?? null;

  it("pinned 1M member lifts a 200K single-member combo to 1M", () => {
    const caps = aggregateComboCapabilities(["tokenharbor/claude-haiku-5.5:free"], null, resolver);
    expect(caps.contextWindow).toBe(1_000_000);
    expect(caps.maxOutput).toBe(128_000);
  });

  it("without a resolver the member's own table value still applies", () => {
    const caps = aggregateComboCapabilities(["claude/claude-haiku-4-5-20251001"]);
    expect(caps.contextWindow).toBe(200_000);
  });
});
