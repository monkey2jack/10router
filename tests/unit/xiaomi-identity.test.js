/**
 * Xiaomi identity matching — one connection per Xiaomi account.
 *
 * Locks the shared matcher used by BOTH the browser-exchange and api-key
 * routes, so the two cannot drift apart again (they used to have different
 * rule lists, which could leave one account with two rows).
 */
import { describe, expect, it } from "vitest";
import { matchesXiaomiIdentity, findXiaomiConnection } from "../../src/lib/oauth/xiaomiIdentity.js";

const row = (psd = {}, extra = {}) => ({
  id: "c1",
  provider: "xiaomi-mimo",
  accessToken: "sk-abc",
  providerSpecificData: psd,
  ...extra,
});

describe("matchesXiaomiIdentity", () => {
  it("matches on uid stored either as uid or mimoUserId", () => {
    expect(matchesXiaomiIdentity(row({ uid: "6786673" }), { uid: "6786673" })).toBe(true);
    expect(matchesXiaomiIdentity(row({ mimoUserId: "6786673" }), { uid: "6786673" })).toBe(true);
  });

  it("matches on the synthetic email form", () => {
    expect(matchesXiaomiIdentity(row({}, { email: "6786673@xiaomi" }), { uid: "6786673" })).toBe(true);
  });

  it("falls back to mimoUserId when the payload has no uid", () => {
    // This is the case that used to create a duplicate row: browser payload
    // without uid, desktop session that does know the account.
    expect(matchesXiaomiIdentity(row({ mimoUserId: "6786673" }), { mimoUserId: "6786673" })).toBe(true);
  });

  it("matches an identical access token (same key imported twice)", () => {
    expect(matchesXiaomiIdentity(row({}, { accessToken: "sk-abc" }), { key: "sk-abc" })).toBe(true);
  });

  it("does NOT match a different account", () => {
    expect(matchesXiaomiIdentity(row({ mimoUserId: "1111111" }), { uid: "6786673" })).toBe(false);
    expect(matchesXiaomiIdentity(row({ mimoUserId: "1111111" }), { mimoUserId: "6786673" })).toBe(false);
  });

  it("does NOT match other providers even with the same uid", () => {
    const other = { provider: "gemini", providerSpecificData: { uid: "6786673" } };
    expect(matchesXiaomiIdentity(other, { uid: "6786673" })).toBe(false);
  });

  it("does NOT match the Token Plan card (different credential family)", () => {
    const tp = { provider: "xiaomi-tokenplan", providerSpecificData: { uid: "6786673" } };
    expect(matchesXiaomiIdentity(tp, { uid: "6786673" })).toBe(false);
  });

  it("matches mimo-desktop rows — the Desktop import pre-filters by provider", () => {
    // The api-key route hands the matcher rows already filtered to
    // `mimo-desktop`; hard-rejecting that provider meant the Desktop card never
    // matched its own existing rows, so every re-import stacked a duplicate.
    const desktop = {
      provider: "mimo-desktop",
      accessToken: "mimo-desktop-session-6786673",
      providerSpecificData: { mimoUserId: "6786673" },
    };
    expect(matchesXiaomiIdentity(desktop, { uid: "6786673" })).toBe(true);
    expect(matchesXiaomiIdentity(desktop, { mimoUserId: "6786673" })).toBe(true);
    expect(matchesXiaomiIdentity(desktop, { key: "mimo-desktop-session-6786673" })).toBe(true);
    // …but a different desktop account still does not match.
    expect(matchesXiaomiIdentity(desktop, { uid: "1111111" })).toBe(false);
  });

  it("findXiaomiConnection returns the matching row or null", () => {
    const rows = [row({ mimoUserId: "1111111" }, { id: "a" }), row({ mimoUserId: "6786673" }, { id: "b" })];
    expect(findXiaomiConnection(rows, { uid: "6786673" })?.id).toBe("b");
    expect(findXiaomiConnection(rows, { uid: "9999999" })).toBeNull();
  });
});
