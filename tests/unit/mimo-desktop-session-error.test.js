/**
 * Issue #13 — MiMo Desktop-exclusive preview models without a desktop session.
 *
 * Locks the three acceptance points:
 * 1. the executor throws the friendly message (no "passToken" jargon), tagged
 *    MIMO_DESKTOP_SESSION_REQUIRED;
 * 2. errorConfig matches it with cooldown 0 — no account lock, no "(reset after
 *    30s)", combo falls through immediately;
 * 3. the zh-CN / zh-TW literal entries exist for the message and the dashboard
 *    badge (a missing entry shows raw English in the Chinese UI — red test).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import XiaomiMimoExecutor from "../../open-sse/executors/xiaomi-mimo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const SESSION_MESSAGE =
  "This model requires the Xiaomi MiMo desktop account. Sign in to MiMo Desktop once, then retry.";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("issue 13: mimo desktop session error", () => {
  it("executor throws the friendly message with MIMO_DESKTOP_SESSION_REQUIRED (no passToken wording)", async () => {
    // Isolate from a locally-signed-in MiMo Desktop: the cookie lookup falls back
    // to the desktop app's profile dir (APPDATA on Windows). Redirect it to an
    // empty temp dir so the "no session" gate is deterministic on dev machines
    // that DO have a real desktop login — otherwise the executor proceeds past
    // the gate and the test becomes a live-network test.
    const savedAppData = process.env.APPDATA;
    process.env.APPDATA = join(tmpdir(), `mimo-session-test-empty-${process.pid}`);
    try {
      const executor = new XiaomiMimoExecutor("mimo-desktop");
      await expect(
        executor.execute({
          model: "mimo-v2.6-flash",
          credentials: { providerSpecificData: {} }, // no session → no cookie
          proxyOptions: null,
        }),
      ).rejects.toMatchObject({
        code: "MIMO_DESKTOP_SESSION_REQUIRED",
        message: SESSION_MESSAGE,
      });
    } finally {
      if (savedAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppData;
    }
    expect(SESSION_MESSAGE).not.toContain("passToken");
  });

  it("scopes the session gate to the Desktop card, not the model id", () => {
    // Both cards sell mimo-v2.6-flash; only the provider decides whether an
    // account session is demanded — a model-id rule would gate the cloud card too.
    expect(new XiaomiMimoExecutor().usesAccountSession()).toBe(false);
    expect(new XiaomiMimoExecutor("mimo-desktop").usesAccountSession()).toBe(true);
  });

  it("errorConfig: matches with cooldown 0 — no lock, no (reset after 30s)", () => {
    const res = checkFallbackError(502, `[xiaomi-mimo/mimo-x-flash-preview] ${SESSION_MESSAGE} (account unavailable)`);
    expect(res.shouldFallback).toBe(true);
    expect(res.cooldownMs).toBe(0);
  });

  it("unrelated errors keep the default transient cooldown (rule is specific)", () => {
    const res = checkFallbackError(502, "some other gateway error");
    expect(res.cooldownMs).toBeGreaterThan(0);
  });

  it("literals: zh-CN and zh-TW both carry the message and badge entries", () => {
    for (const locale of ["zh-CN", "zh-TW"]) {
      const dict = JSON.parse(readFileSync(join(ROOT, `public/i18n/literals/${locale}.json`), "utf8"));
      expect(dict[SESSION_MESSAGE], `${locale} message entry`).toBeTruthy();
      expect(dict["Desktop sign-in"], `${locale} badge entry`).toBeTruthy();
      expect(dict["Requires MiMo Desktop sign-in — API key alone cannot reach this model"], `${locale} badge tooltip`).toBeTruthy();
    }
  });

  it("registry: the Desktop card's models are all flagged requiresSession", async () => {
    // The dashboard badge has to follow the account-session surface, and the base
    // card must not advertise any of them (a cloud key cannot reach them).
    const { default: desktop } = await import("../../open-sse/providers/registry/mimo-desktop.js");
    const flagged = desktop.models.filter((m) => m.requiresSession === true).map((m) => m.id);
    expect(flagged.sort()).toEqual([
      "mimo-v2.6-flash",
      "mimo-v2.6-pro",
      "mimo-v2.6-pro-ultraspeed",
    ]);
    const { default: base } = await import("../../open-sse/providers/registry/xiaomi-mimo.js");
    expect(base.models.filter((m) => m.requiresSession === true)).toEqual([]);
  });
});
