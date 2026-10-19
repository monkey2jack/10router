import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  updateProviderConnection,
} from "@/models";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { readCliToken, readDashboardPassword } from "@/lib/auth/authHeaders";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(readCliToken(request));
}

/**
 * POST /api/oauth/codebuddy-cn/bulk-import
 * Import CodeBuddy CN (codebuddy.cn / copilot.tencent.com) OAuth accounts from a
 * JSON export (e.g. an account-switcher / CLI token dump). Each token pair is
 * registered as (or merged into) a codebuddy-cn connection.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *
 * Each item is read from either snake_case (wb / CLI export) or camelCase:
 *   access_token | accessToken        -> required
 *   refresh_token| refreshToken       -> optional (falls back to no refresh)
 *   nickname                          -> preferred connection name
 *   email                             -> connection email (optional)
 *   expiresAt (ms) | expiresIn (s)    -> token lifetime (optional)
 *
 * Only items whose token issuer is a CodeBuddy CN realm are imported.
 * Tokens signed by other domains (e.g. www.workbuddy.cn) are skipped — they
 * are a different Keycloak realm and not accepted by the codebuddy-cn gateway.
 *
 * Dedup / merge: an existing connection whose access token has the same `sub`
 * (Keycloak uid) — or, failing that, the same name — is UPDATED in place rather
 * than duplicated. New identities create a fresh connection.
 *
 * Tokens are NEVER echoed back in the response.
 */
export async function POST(request) {
  // Sensitive write (imports credentials) — require the dashboard password (CLI token bypasses).
  if (!isCliRequest(request) && !(await verifyDashboardPassword(readDashboardPassword(request)))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  // Normalize to an array.
  let accounts;
  if (Array.isArray(body)) accounts = body;
  else if (body && typeof body === "object" && Array.isArray(body.accounts)) accounts = body.accounts;
  else if (body && typeof body === "object") accounts = [body];
  else accounts = null;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
  }

  const decodeJwt = (jwt) => {
    try {
      const seg = String(jwt).split(".")[1];
      const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      return JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
    } catch {
      return null;
    }
  };

  // codebuddy-cn gateway realms (Keycloak issuer domains that are accepted).
  const isCnIssuer = (iss) =>
    typeof iss === "string" &&
    (iss.includes("codebuddy.cn") || iss.includes("copilot.tencent.com"));

  const existing = await getProviderConnections({ provider: "codebuddy-cn" });

  const results = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  // SERIAL — create/update read + reorder inside a transaction; parallel races on priority.
  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }
      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        auth_raw: authRaw,
        profile_raw: _profileRaw,
        domain: rawDomain,
        ...item
      } = raw;

      const accessToken =
        item.accessToken || item.access_token || authRaw?.accessToken || raw?.access_token;
      if (!accessToken || typeof accessToken !== "string") {
        throw new Error("Missing accessToken");
      }

      // Realm gate — only CodeBuddy CN issuers are routable via codebuddy-cn.
      const claims = decodeJwt(accessToken);
      const iss = claims?.iss || rawDomain || "";
      if (!isCnIssuer(iss)) {
        results.push({ index: i, ok: true, skipped: true, reason: `issuer not CodeBuddy CN: ${iss}` });
        skipped++;
        continue;
      }

      // Preferred connection name: explicit nickname -> JWT preferred_username -> "Account N".
      const nickname = item.nickname || claims?.nickname || claims?.preferred_username || null;

      const refreshToken =
        item.refreshToken || item.refresh_token || authRaw?.refreshToken || raw?.refresh_token || null;

      // expiresAt: prefer the token's own exp (epoch seconds, authoritative),
      // then explicit ms/ISO, then compute from a lifetime in seconds.
      let expiresAt = null;
      let expiresIn = null;
      if (claims && typeof claims.exp === "number" && claims.exp > 0) {
        expiresAt = new Date(claims.exp * 1000).toISOString();
      } else if (typeof item.expiresAt === "number") {
        expiresAt = new Date(item.expiresAt).toISOString();
      } else if (typeof item.expiresAt === "string" && !Number.isNaN(Date.parse(item.expiresAt))) {
        expiresAt = new Date(item.expiresAt).toISOString();
      } else {
        const ei = item.expiresIn || authRaw?.expiresIn;
        if (typeof ei === "number" && ei > 0 && ei < 1e8) {
          expiresAt = new Date(Date.now() + ei * 1000).toISOString();
        }
      }
      if (typeof item.expiresIn === "number" && item.expiresIn > 0) expiresIn = item.expiresIn;

      const email = item.email || null;

      // Dedup: same Keycloak `sub` (uid) in an existing connection wins; fall back to name.
      const sub = claims?.sub || null;
      let match = null;
      if (sub) {
        for (const c of existing) {
          const cClaims = decodeJwt(c.accessToken);
          if (cClaims?.sub === sub) { match = c; break; }
        }
      }
      if (!match && nickname) {
        match = existing.find((c) => c.name === nickname) || null;
      }

      const payload = {
        provider: "codebuddy-cn",
        authType: "oauth",
        accessToken,
        refreshToken,
        name: nickname || undefined,
        email: email || undefined,
        expiresAt: expiresAt || undefined,
        expiresIn: expiresIn || undefined,
        testStatus: "active",
      };

      if (match) {
        await updateProviderConnection(match.id, payload);
        updated++;
        results.push({ index: i, ok: true, updated: true, id: match.id });
      } else {
        const created = await createProviderConnection(payload);
        existing.push(created); // keep dedup list fresh for later items
        imported++;
        results.push({ index: i, ok: true, created: true, id: created.id });
      }
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ imported, updated, skipped, failed, results });
}
