import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { hardenOwnerOnly } from "@/lib/fsPermissions";

// There is deliberately no hardcoded fallback password. A fresh install used to
// accept the literal "123456", and because the launcher binds 0.0.0.0 by
// default that made every un-configured instance admin-open to the whole LAN in
// one guess (issue #9: default listener + default password + plaintext
// credentials). Instead:
//   * `INITIAL_PASSWORD` is the only non-interactive bootstrap password (it is
//     what Docker / fnOS installs set, and it is never "123456" by default);
//   * with no password configured at all the dashboard is loopback-only, so the
//     operator sitting at the machine can set one while remote clients are
//     refused outright (see dashboardGuard.isAuthenticated).
const BOOTSTRAP_PASSWORD_ENV = "INITIAL_PASSWORD";

export function getBootstrapPassword() {
  const fromEnv = process.env[BOOTSTRAP_PASSWORD_ENV];
  return typeof fromEnv === "string" ? fromEnv.trim() : "";
}

// Does the dashboard have *any* way to authenticate a client? Password hash,
// bootstrap env var or SSO. When false, "unauthenticated" means "nothing to ask
// for", and the guard falls back to loopback trust so a password can be set.
// The SSO checks mirror isOidcConfigured / isSamlConfigured but are inlined on
// purpose: this helper runs inside the per-request proxy, and importing the SAML
// module there would pull XML/crypto machinery into that graph for two key
// reads.
export function isDashboardAuthConfigured(settings) {
  if (getBootstrapPassword()) return true;
  return hasOwnDashboardCredential(settings);
}

// A credential the OPERATOR chose: a stored password hash or a complete SSO
// setup — deliberately NOT the bootstrap INITIAL_PASSWORD. On fnOS that one is
// generated at install time into a file the user never sees, so turning the
// log-in check on with nothing but it locked people out: every password they
// tried got 401 (issue #33). Settings PATCH refuses requireLogin=true without one.
export function hasOwnDashboardCredential(settings) {
  if (settings?.password) return true;
  const oidcReady =
    String(settings?.oidcIssuerUrl || "").trim() &&
    String(settings?.oidcClientId || "").trim() &&
    String(settings?.oidcClientSecret || "").trim();
  if (oidcReady) return true;
  return Boolean(settings?.samlEntryPoint && settings?.samlCert);
}

// Session lifetime. The token's `exp` and the cookie's `maxAge` are both derived
// from this one value on purpose: with no maxAge at all the browser treats
// `auth_token` as a session cookie and drops it on browser close, so a user who
// is still well inside their token gets logged out by closing a window.
//
// Shortened from 24h (issue #9, item 8: a stolen cookie stayed usable for a
// whole day). Two hours is only comfortable because the session SLIDES: see
// renewDashboardAuthCookie — any authenticated page view re-issues the token
// once it is past half its life, so an active operator is never interrupted
// while a token that leaks is worthless within two hours.
const SESSION_MAX_AGE_SEC = 2 * 60 * 60;

// Absolute session lifetime, measured from the ORIGINAL sign-in and carried
// across every renewal. Without it the sliding renewal is unbounded: each
// renewal mints a token with a fresh `iat`, so a stolen cookie that is presented
// at least once per half-life can be renewed indefinitely and the 2-hour window
// never closes. `origIat` is signed into the token at creation, so a client
// cannot set or extend it — it only ever makes the session die sooner.
//
// 30 days is the "I left a tab open" ceiling, not a security boundary; the
// security work is the 2h sliding window. Re-authenticating thereafter is the
// intended cost.
const SESSION_ABSOLUTE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function readOrigIat(session) {
  const orig = typeof session?.origIat === "number" ? session.origIat : null;
  const iat = typeof session?.iat === "number" ? session.iat : null;
  // A token minted before this claim existed falls back to its own iat, which is
  // the best available approximation of when the session started.
  return orig ?? iat;
}

// Placeholder values that ship in .env.example / old builds' source. A secret
// the whole internet can guess is worse than no secret — fall back to the
// auto-generated one instead of signing sessions with a public string.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-secret",
  "10router-default-secret-change-me",
  "change-me-to-a-random-string", // legacy fnOS fpk-generated .env default
  "change-me",
]);

function loadJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (!KNOWN_PLACEHOLDER_SECRETS.has(fromEnv)) return fromEnv;
    console.warn(
      "[auth] JWT_SECRET is a known placeholder value — ignoring it. " +
        "Leave JWT_SECRET unset (a random secret is generated to " +
        path.join(DATA_DIR, "jwt-secret") + ") or set a long random value.",
    );
  }
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  hardenOwnerOnly(file); // 0o600 is a no-op on Windows — restrict the ACL there too.
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  // Multi-hop proxies may send "https,http" — trust the first (client-facing) hop.
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto") || "";
  const firstHop = String(forwardedProto).split(",")[0].trim().toLowerCase();
  return forceSecureCookie || firstHop === "https";
}

export async function createDashboardAuthToken(claims = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    authenticated: true,
    // Carried across renewals so the absolute cap can be enforced; a renewal
    // passes the original through and cannot move it forward.
    origIat: nowSec,
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Sliding session (issue #9, item 8). Call on an authenticated request: when the
// presented token is past half its life, hand back a fresh one so an active user
// never hits an expiry, while a token that leaked has a short window. Failures are
// silent — the worst case is the old behaviour (the user re-authenticates).
export async function renewDashboardAuthCookie(cookieStore, request, session) {
  try {
    const iat = typeof session?.iat === "number" ? session.iat * 1000 : 0;
    if (!iat) return false;
    // Absolute cap: a session older than this is NOT renewed, so it dies at its
    // next expiry regardless of how actively it is used. Refusing here (rather
    // than handing back a short-lived token) keeps the failure honest — the user
    // is asked to sign in again.
    const origIat = readOrigIat(session);
    if (origIat) {
      const ageSec = Math.floor(Date.now() / 1000) - origIat;
      if (ageSec >= SESSION_ABSOLUTE_MAX_AGE_SEC) return false;
    }
    const halfLifeMs = (SESSION_MAX_AGE_SEC * 1000) / 2;
    if (Date.now() - iat < halfLifeMs) return false;
    await setDashboardAuthCookie(cookieStore, request, {
      // Preserve the original sign-in time across renewals; falling back to the
      // presented iat keeps the chain intact for tokens minted before origIat
      // existed.
      ...(origIat ? { origIat } : {}),
      ...(session?.oidcName ? { oidcName: session.oidcName } : {}),
      ...(session?.oidcEmail ? { oidcEmail: session.oidcEmail } : {}),
      ...(session?.samlName ? { samlName: session.samlName } : {}),
      ...(session?.samlEmail ? { samlEmail: session.samlEmail } : {}),
      ...(session?.oidc ? { oidc: true } : {}),
      ...(session?.saml ? { saml: true } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const bootstrap = getBootstrapPassword();
  if (!bootstrap) return false;
  return password === bootstrap;
}
