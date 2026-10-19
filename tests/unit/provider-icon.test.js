// getProviderIconSrc hardcodes /providers/{id}.png for most providers, but
// some assets ship as SVG (bai). ICON_EXTENSIONS must win over the default
// extension, and the session 404 cache must still suppress repeat lookups.
import { describe, it, expect, beforeEach } from "vitest";

import {
  getProviderIconSrc,
  markProviderIconMissing,
} from "@/shared/utils/providerIcon.js";

describe("providerIcon", () => {
  beforeEach(() => {
    // failedIds is module state — isolate each case from prior misses.
    vi.resetModules();
  });

  it("resolves png by default", async () => {
    const mod = await import("@/shared/utils/providerIcon.js");
    expect(mod.getProviderIconSrc("longcat")).toBe("/providers/longcat.png");
    expect(mod.getProviderIconSrc("qoder-cn")).toBe("/providers/qoder-cn.png");
    expect(mod.getProviderIconSrc("qoder")).toBe("/providers/qoder.png");
  });

  it("resolves svg for providers in ICON_EXTENSIONS", async () => {
    const mod = await import("@/shared/utils/providerIcon.js");
    expect(mod.getProviderIconSrc("bai")).toBe("/providers/bai.svg");
    expect(mod.getProviderIconSrc("B.AI")).toBe("/providers/bai.svg");
  });

  it("suppresses lookups after a miss", async () => {
    const mod = await import("@/shared/utils/providerIcon.js");
    expect(mod.getProviderIconSrc("dots")).toBe("/providers/dots.png");
    mod.markProviderIconMissing("dots");
    expect(mod.getProviderIconSrc("dots")).toBeNull();
  });
});
