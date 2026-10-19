/**
 * Agnes AI registry model seeds.
 *
 * The intl catalog was probed from /v1/models on 2026-09-03 with the two text
 * models below it. The upstream catalog since carries agnes-2.5-pro-beta and
 * agnes-3.0-flash; this pins the seeded set and the shape of every entry so the
 * dashboard has selectable ids as soon as a key is saved.
 */
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const agnes = REGISTRY.find((p) => p.id === "agnes-ai");

describe("agnes-ai registry seeds", () => {
  it("keeps the probed pair and adds the 2.5-pro-beta / 3.0-flash seeds", () => {
    expect(agnes).toBeDefined();
    expect(agnes.models.filter((m) => !m.kind).map((m) => m.id)).toEqual([
      "agnes-2.5-flash",
      "agnes-2.5-pro",
      "agnes-2.5-pro-beta",
      "agnes-3.0-flash",
    ]);
  });

  it("gives every seeded model a non-empty display name", () => {
    for (const m of agnes.models) {
      expect(typeof m.name, m.id).toBe("string");
      expect(m.name.length, m.id).toBeGreaterThan(0);
    }
  });

  it("leaves transport untouched", () => {
    expect(agnes.transport.baseUrl).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    expect(agnes.transport.validateUrl).toBe("https://apihub.agnes-ai.com/v1/models");
  });
});
