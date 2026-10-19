/**
 * Quota page provider filter — ?provider= URL deep link.
 *
 * The filter used to live only in localStorage ("quotaProviderFilter"), so a
 * bookmarked /dashboard/quota?provider=codex URL dropped the selection on load.
 * The pure helpers below pin the merge order (URL wins, storage is the
 * fallback) and the URL writeback shape; the source guards pin the component
 * wiring (router.replace with scroll:false) that the helpers sit behind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getInitialProviderFilter,
  buildProviderFilterUrl,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("getInitialProviderFilter", () => {
  it("prefers the URL ?provider= param over the stored selection", () => {
    expect(getInitialProviderFilter("codex", "claude")).toBe("codex");
  });

  it("falls back to the persisted localStorage selection without a URL param", () => {
    expect(getInitialProviderFilter(null, "claude")).toBe("claude");
    expect(getInitialProviderFilter("", "claude")).toBe("claude");
  });

  it("defaults to all when neither URL nor storage has a selection", () => {
    expect(getInitialProviderFilter(null, null)).toBe("all");
    expect(getInitialProviderFilter(undefined, "")).toBe("all");
  });
});

describe("buildProviderFilterUrl", () => {
  it("sets ?provider= for a specific provider", () => {
    expect(buildProviderFilterUrl("/dashboard/quota", "", "codex")).toBe("/dashboard/quota?provider=codex");
  });

  it("preserves unrelated query params", () => {
    expect(buildProviderFilterUrl("/dashboard/quota", "tab=overview", "claude")).toBe(
      "/dashboard/quota?tab=overview&provider=claude",
    );
  });

  it("replaces an existing provider param instead of duplicating it", () => {
    expect(buildProviderFilterUrl("/dashboard/quota", "provider=claude", "codex")).toBe(
      "/dashboard/quota?provider=codex",
    );
  });

  it("drops the param entirely when 'all' is selected", () => {
    expect(buildProviderFilterUrl("/dashboard/quota", "provider=codex", "all")).toBe("/dashboard/quota");
  });

  it("keeps other params when dropping provider", () => {
    expect(buildProviderFilterUrl("/dashboard/quota", "tab=overview&provider=codex", "all")).toBe(
      "/dashboard/quota?tab=overview",
    );
  });
});

const abs = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const read = (rel) => readFileSync(abs(rel), "utf8");

describe("ProviderLimits component wiring (source guards)", () => {
  const src = read("src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js");

  it("reads useSearchParams / useRouter / usePathname from next/navigation", () => {
    expect(src).toMatch(/import\s*\{\s*useSearchParams,\s*useRouter,\s*usePathname\s*\}\s*from\s*"next\/navigation"/);
  });

  it("initializes providerFilter via getInitialProviderFilter with the URL param", () => {
    expect(src).toContain("getInitialProviderFilter(searchParams?.get(\"provider\")");
  });

  it("syncs the filter back to the URL with router.replace({ scroll: false })", () => {
    expect(src).toMatch(/router\.replace\(buildProviderFilterUrl\(pathname,[\s\S]*?\{ scroll: false \}\)/);
  });

  it("keeps the localStorage persistence effect as the no-URL fallback", () => {
    expect(src).toContain("window.localStorage.setItem(\"quotaProviderFilter\", providerFilter)");
  });
});
