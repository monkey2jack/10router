/**
 * Usage stats provider list must skip hidden providers.
 *
 * Since zed (`hidden: true` in the registry) a provider can stay out of the
 * dashboard on purpose. No-auth providers already honored `!p.hidden`, but the
 * connected-accounts branch only filtered community providers — a connected
 * hidden provider still showed up in the stats provider list. Source guards,
 * because the branch is inline JSX; both branches are pinned so they cannot
 * drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const abs = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const src = readFileSync(abs("src/shared/components/UsageStats.js"), "utf8");

describe("UsageStats hidden-provider exclusion", () => {
  it("filters hidden providers from the connected-accounts branch", () => {
    expect(src).toContain("AI_PROVIDERS[c.provider]?.hidden");
  });

  it("keeps the community filter in the same branch", () => {
    expect(src).toContain("isCommunityHidden(c.provider)");
  });

  it("keeps the noAuth branch's existing !p.hidden check (already aligned)", () => {
    expect(src).toContain("!p.hidden");
  });

  it("has AI_PROVIDERS imported for the lookup", () => {
    expect(src).toMatch(/import\s*\{[^}]*AI_PROVIDERS[^}]*\}\s*from\s*"@\/shared\/constants\/providers"/);
  });
});
