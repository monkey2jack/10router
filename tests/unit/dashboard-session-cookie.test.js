// Dashboard session cookie: the JWT lifetime and the cookie's maxAge must agree.
//
// Regression guard for a real logout bug: the token was signed with a 24h exp
// but the cookie carried no maxAge, so browsers treated `auth_token` as a
// session cookie and dropped it on browser close — the user was logged out even
// though their token was still valid.
//
// This is a behaviour test, not a source-text assertion: it drives the real
// cookie writer with a fake cookie store and decodes the token it produces.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `@/lib/dataDir` resolves DATA_DIR at import time and, when it is unset, runs
// the legacy ~/.9router → ~/.10router migration. Point it at a throwaway dir
// (and set an explicit secret) so importing the module has no side effects.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-session-"));
const originalDataDir = process.env.DATA_DIR;
const originalJwtSecret = process.env.JWT_SECRET;
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = "test-secret-for-dashboard-session-cookie";

const {
  setDashboardAuthCookie,
  createDashboardAuthToken,
  renewDashboardAuthCookie,
} = await import("@/lib/auth/dashboardSession.js");
const { decodeJwt } = await import("jose");

// Issue #9, item 8: shortened from 24h. A leaked cookie used to stay usable for
// a whole day; it now expires in two hours, which is only comfortable because the
// session slides (see renewDashboardAuthCookie and the test at the bottom).
const EXPECTED_MAX_AGE_SEC = 2 * 60 * 60;

function captureCookieSet() {
  const calls = [];
  const store = {
    set(...args) {
      calls.push(args);
    },
  };
  return { calls, store };
}

// Minimal stand-in for a Next.js Request — only `headers.get` is consulted.
function requestWithProto(proto) {
  return {
    headers: {
      get: (name) => (String(name).toLowerCase() === "x-forwarded-proto" ? proto : null),
    },
  };
}

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useRealTimers();
});

describe("setDashboardAuthCookie", () => {
  it("sets httpOnly auth_token with a lifetime maxAge, not a session cookie", async () => {
    const { calls, store } = captureCookieSet();
    await setDashboardAuthCookie(store, requestWithProto("http"));

    expect(calls).toHaveLength(1);
    const [name, value, options] = calls[0];
    expect(name).toBe("auth_token");
    expect(typeof value).toBe("string");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    // The point of the fix: without maxAge this is a session cookie.
    expect(options.maxAge).toBe(EXPECTED_MAX_AGE_SEC);
  });

  it("keeps the token expiry equal to the cookie maxAge", async () => {
    // The two must never drift — that drift is exactly what caused the bug
    // (token with an exp, session-scoped cookie).
    const { calls, store } = captureCookieSet();
    await setDashboardAuthCookie(store, requestWithProto("http"));

    const [, token, options] = calls[0];
    const { exp, iat } = decodeJwt(token);
    expect(exp - iat).toBe(EXPECTED_MAX_AGE_SEC);
    expect(options.maxAge).toBe(exp - iat);
  });

  it("marks the cookie secure only behind an https hop", async () => {
    const https = captureCookieSet();
    await setDashboardAuthCookie(https.store, requestWithProto("https"));
    expect(https.calls[0][2].secure).toBe(true);

    // Multi-hop proxies send "https,http" — trust the client-facing hop.
    const multiHop = captureCookieSet();
    await setDashboardAuthCookie(multiHop.store, requestWithProto("https,http"));
    expect(multiHop.calls[0][2].secure).toBe(true);
  });

  it("carries claims through and still gets the same lifetime", async () => {
    const { calls, store } = captureCookieSet();
    await setDashboardAuthCookie(store, requestWithProto("http"), { sub: "oidc-user" });

    const [, token, options] = calls[0];
    const payload = decodeJwt(token);
    expect(payload.sub).toBe("oidc-user");
    expect(payload.authenticated).toBe(true);
    expect(options.maxAge).toBe(EXPECTED_MAX_AGE_SEC);
  });

  it("signs every token with the same lifetime contract", async () => {
    // createDashboardAuthToken is used directly elsewhere; keep it in lockstep.
    const { exp, iat } = decodeJwt(await createDashboardAuthToken());
    expect(exp - iat).toBe(EXPECTED_MAX_AGE_SEC);
  });

  it("stamps origIat at creation so the absolute cap has an anchor", async () => {
    const { origIat, iat } = decodeJwt(await createDashboardAuthToken());
    expect(typeof origIat).toBe("number");
    // Same instant as iat on a fresh sign-in.
    expect(origIat).toBe(iat);
  });
});

// The sliding renewal is what makes a 2h token comfortable, but on its own it is
// UNBOUNDED: each renewal mints a token with a fresh `iat`, so a stolen cookie
// presented at least once per half-life renews forever and the 2h window never
// closes. An absolute cap, carried from the original sign-in, closes it.
describe("renewDashboardAuthCookie absolute lifetime", () => {
  const ABSOLUTE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

  const nowSec = () => Math.floor(Date.now() / 1000);

  it("renews inside the window and carries origIat forward unchanged", async () => {
    const origIat = nowSec() - 5 * 24 * 60 * 60; // 5 days in
    const session = { iat: nowSec() - 2 * 60 * 60, origIat, authenticated: true };
    const { calls, store } = captureCookieSet();

    const renewed = await renewDashboardAuthCookie(store, requestWithProto("http"), session);
    expect(renewed).toBe(true);
    // The cap's anchor must survive the renewal, or the next one restarts the clock.
    expect(decodeJwt(calls[0][1]).origIat).toBe(origIat);
  });

  it("refuses to renew once the session is older than the absolute cap", async () => {
    const origIat = nowSec() - (ABSOLUTE_MAX_AGE_SEC + 60);
    const session = { iat: nowSec() - 2 * 60 * 60, origIat, authenticated: true };
    const { calls, store } = captureCookieSet();

    const renewed = await renewDashboardAuthCookie(store, requestWithProto("http"), session);
    expect(renewed).toBe(false);
    expect(calls).toHaveLength(0); // no cookie written — the session must age out
  });

  it("does not let a renewal advance origIat", async () => {
    // Simulate the attack: keep renewing every half-life. iat keeps moving
    // forward; origIat must not, and the chain must eventually be refused.
    const origIat = nowSec() - 2 * 60 * 60;
    let session = { iat: nowSec() - 2 * 60 * 60, origIat };
    let renewals = 0;
    for (let i = 0; i < 5; i++) {
      const { calls, store } = captureCookieSet();
      const ok = await renewDashboardAuthCookie(store, requestWithProto("http"), session);
      if (!ok) break;
      renewals++;
      const fresh = decodeJwt(calls[0][1]);
      expect(fresh.origIat).toBe(origIat); // never moves
      session = { iat: fresh.iat, origIat: fresh.origIat };
    }
    expect(renewals).toBeGreaterThan(0); // renewal does work in-window

    // Now age it past the cap and confirm it stops.
    const expired = { iat: nowSec() - 2 * 60 * 60, origIat: nowSec() - ABSOLUTE_MAX_AGE_SEC - 1 };
    const { calls, store } = captureCookieSet();
    expect(await renewDashboardAuthCookie(store, requestWithProto("http"), expired)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("falls back to iat for tokens minted before origIat existed", async () => {
    // An already-issued cookie has no origIat; it must still be renewable, using
    // its own iat as the best available anchor.
    const iat = nowSec() - 2 * 60 * 60;
    const legacy = { iat, authenticated: true };
    const { calls, store } = captureCookieSet();
    expect(await renewDashboardAuthCookie(store, requestWithProto("http"), legacy)).toBe(true);
    expect(decodeJwt(calls[0][1]).origIat).toBe(iat);
  });
});
