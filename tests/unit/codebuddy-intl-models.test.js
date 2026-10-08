import { describe, expect, it } from "vitest";
import entry from "../../open-sse/providers/registry/codebuddy-intl.js";
import cnEntry from "../../open-sse/providers/registry/codebuddy-cn.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("CodeBuddy international static model catalog", () => {
  it("does not advertise models confirmed by the intl gateway as 11102", () => {
    const ids = entry.models.map((model) => model.id);
    expect(ids).not.toEqual(expect.arrayContaining([
      // rejected with 11102 "model service info not found" on a live probe
      "glm-5.0-turbo",
      "glm-4.7",
      "glm-4.6",
      "glm-4.5",
      "minimax-m2.7",
      "hy3-preview",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4.1-pro",
      "deepseek-v3.2",
      "deepseek-v3-2-volc",
      "kimi-k2-thinking",
      "gpt-5.2",
      "gpt-5.1",
      "gpt-5.6",
      // re-probed 2026-09-30 alongside the 6.0 sol/luna additions
      "gpt-6",
      "gpt-6.1-sol",
      "gpt-6.1-luna",
      "gpt-6.1-astra",
      "gpt-6.5-astra",
      "gemini-3.5-pro",
      "gemini-3-flash",
      "qwen3-max",
      "claude-sonnet-4.5",
      "hy4",
      // answers 200 on a live probe but is absent from the published credit
      // list, so it is kept out — same reason the CN catalog drops it.
      "kimi-k2.5",
    ]));
  });

  it("advertises the models the live intl gateway answers", () => {
    const ids = entry.models.map((model) => model.id);
    expect(ids).toEqual([
      "auto",
      "hy4-preview",
      "hy3",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-6.1-sol",
      "gemini-3.8-flash",
      "grok-4.7",
      "space-bunny",
      "gemini-3.5-flash",
      "glm-5v-turbo",
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.2",
      "glm-5.1",
      "minimax-m3",
      "kimi-k3",
      "kimi-k2.8-preview",
      "kimi-k2.6",
      "deepseek-v4.1-flash",
    ]);
  });

  it("carries the published name and credit multiplier for the probed additions", () => {
    const byId = Object.fromEntries(entry.models.map((model) => [model.id, model]));
    // every one of these answered 200 on a live request through the gateway
    expect(byId["deepseek-v4.1-flash"]).toMatchObject({ name: "DeepSeek-V4.1-Flash", rateMultiplier: 0.11 });
    expect(byId["glm-5.1"]).toMatchObject({ name: "GLM-5.1", rateMultiplier: 0.79 });
    expect(byId["glm-5v-turbo"]).toMatchObject({ name: "GLM-5v-Turbo", rateMultiplier: 0.71 });
    expect(byId["minimax-m3"]).toMatchObject({ name: "MiniMax-M3", rateMultiplier: 0.25 });
    expect(byId["kimi-k2.6"]).toMatchObject({ name: "Kimi-K2.6", rateMultiplier: 0.52 });
  });

  it("drops kimi-k2.7, absent from the intl credit page (CN keeps it)", () => {
    // The 2026-10-09 intl credit page lists Kimi-K3 (1.62) and Kimi-K2.6 (0.52)
    // but no Kimi-K2.7-Code, so the row was retired from intl even though a live
    // probe had answered 200. CN still publishes it at 0.57 and keeps its row —
    // the two catalogs are independent, so neither side inherits the other's
    // availability, only its credit multiplier (see the parity case above).
    const ids = entry.models.map((model) => model.id);
    expect(ids).not.toContain("kimi-k2.7");
    expect(cnEntry.models.map((model) => model.id)).toContain("kimi-k2.7");
  });

  it("pins gpt-6-astra's measured multiplier, not the superseded estimate", () => {
    // v1.1.0 shipped 17.35 here — a ratio estimate off the OpenCode Go price
    // table, where Astra sits at exactly 5x Sol. The real credit system does
    // not follow that ratio, so the measured 6.67 replaces it. Asserted as an
    // exact value on purpose: the ratio's derivation is dead, and the negative
    // assertion below is what stops anyone from re-deriving it from Sol.
    const byId = Object.fromEntries(entry.models.map((model) => [model.id, model]));
    expect(byId["gpt-6-astra"]).toMatchObject({ name: "GPT 6.0 Astra", rateMultiplier: 6.67 });
    expect(byId["gpt-6-astra"].rateMultiplier).not.toBeCloseTo(
      byId["gpt-5.6-sol"].rateMultiplier * 5,
      10,
    );
    // it has a real multiplier, so it must never carry a permanent
    // "rides the free quota" claim nor a promo window
    expect(byId["gpt-6-astra"].promoFreeUntil).toBeUndefined();
  });

  it("lists auto as the gateway's own routing id, not a UI-only preset", () => {
    // The intl credit page shows five agent presets: Auto 0.79 / Fast 0.34 /
    // Balanced 0.59 / Primary 3.31 / Deep 3.33. Only `auto` is a real model id —
    // it answers 200 and echoes back the model it picked. The other four 11102
    // across 20 spellings (title case, auto-xxx, xxx-mode, cb-xxx), so the chat
    // app resolves them before it sends anything. Only Auto belongs here; adding
    // the rest would advertise ids the gateway rejects.
    const byId = Object.fromEntries(entry.models.map((model) => [model.id, model]));
    expect(byId["auto"]).toMatchObject({ name: "Auto", rateMultiplier: 0.79 });
    for (const preset of ["fast", "balanced", "primary", "deep"]) {
      expect(byId[preset]).toBeUndefined();
    }
    // 0.79 is the multiplier of the model auto actually resolves to (glm-5.2), so
    // it is not a coincidence the price could be taken from the CN credit page.
    expect(byId["auto"].rateMultiplier).toBe(byId["glm-5.2"].rateMultiplier);
  });

  it("records auto's capabilities as GLM-5.2's, not the canonical fallback", () => {
    // A 2026-10-09 probe sent five different prompts (zh/en, code/math/physics)
    // to model:"auto" and every response echoed model:"glm-5.2", so it is logged
    // as GLM-5.2. The canonical fallback row says vision:false / 200000 /
    // 131072 — under-reporting the window 5x and letting max_tokens past the
    // 48000 clamp the gateway actually enforces. intl publishes no config
    // endpoint of its own (10 candidate paths, all 404), so CN's glm-5.2 row is
    // the source: one credit system, one model.
    expect(getCapabilitiesForModel("codebuddy-intl", "auto")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
      contextWindow: 1000000,
      maxOutput: 48000,
    });
  });

  it("keeps a shared CN/intl model at the same credit multiplier", () => {
    // CN and intl bill from one credit system, so an id present on both sides
    // must not drift apart — this is what lets a new intl model inherit the CN
    // multiplier instead of guessing one.
    const cnById = Object.fromEntries(cnEntry.models.map((model) => [model.id, model]));
    // hy4-preview diverged on purpose (user-verified 2026-09-13): intl is free
    // ALL DAY (0), CN is night-only free (23:00–08:00, no daytime multiplier).
    const shared = entry.models.filter((model) => cnById[model.id] && model.id !== "hy4-preview");
    expect(shared.length).toBeGreaterThanOrEqual(10);
    for (const model of shared) {
      expect([model.id, model.rateMultiplier]).toEqual([model.id, cnById[model.id].rateMultiplier]);
    }
  });

  it("keeps intl hy4-preview free all day (diverged from CN night-only free)", () => {
    const hy4 = entry.models.find((model) => model.id === "hy4-preview");
    expect(hy4.rateMultiplier).toBe(0);
    expect(hy4.nightFree).toBeUndefined();
  });

  it("inherits glm-5.3-flash's multiplier from the shared CN credit system", () => {
    // CN has listed glm-5.3-flash at 0.06 all along; intl answered 11102
    // until the 2026-09-30 probe. One credit system → same number.
    const byId = Object.fromEntries(entry.models.map((model) => [model.id, model]));
    expect(byId["glm-5.3-flash"]).toMatchObject({ name: "GLM-5.3-Flash", rateMultiplier: 0.06 });
  });

  it("ships the intl-only GPT-6 sol/luna rows without a guessed multiplier", () => {
    // CN answers 11102 for both, so there is no CN credit-page row to
    // inherit, and the dead astra-ratio method (Sol × N) must not resurface.
    const byId = Object.fromEntries(entry.models.map((model) => [model.id, model]));
    expect(byId["gpt-6-luna"].rateMultiplier).toBeUndefined();
    expect(byId["gpt-6-sol"].rateMultiplier).toBeUndefined();
  });
});
