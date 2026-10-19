import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { readCliToken, readDashboardPassword } from "@/lib/auth/authHeaders";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(readCliToken(request));
}

/**
 * GET /api/oauth/codebuddy-cn/export
 * Export all codebuddy-cn connections as a third-party (wb account-switcher)
 * JSON array, so they can be re-imported elsewhere (or backed up).
 *
 * Format mirrors the wb-switch-accounts export: each item is the account's
 * OAuth state keyed by the same field names the tool reads. Only connections
 * whose token issuer is a CodeBuddy CN realm are included.
 *
 * Tokens ARE present in the response by design (it is an export) — this route
 * is behind dashboard auth; be careful where the file is saved.
 */
function decodeJwt(jwt) {
  try {
    const seg = String(jwt).split(".")[1];
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function GET(request) {
  try {
    // Sensitive export — require the dashboard password (CLI token bypasses).
    if (!isCliRequest(request) && !(await verifyDashboardPassword(readDashboardPassword(request)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const connections = await getProviderConnections({ provider: "codebuddy-cn" });
    const now = Date.now();

    const accounts = [];
    for (const c of connections) {
      const accessToken = c.accessToken;
      if (!accessToken) continue;
      const claims = decodeJwt(accessToken) || {};
      const iss = claims.iss || "";
      // Only CodeBuddy CN realm tokens (codebuddy.cn / copilot.tencent.com).
      if (!iss.includes("codebuddy.cn") && !iss.includes("copilot.tencent.com")) continue;

      const host = (() => {
        try { return new URL(iss).hostname; } catch { return "www.codebuddy.cn"; }
      })();
      const expMs = typeof claims.exp === "number" ? claims.exp * 1000 : null;
      const accessExp = expMs && expMs > now ? expMs : null;

      const nickname = c.name || claims.nickname || claims.preferred_username || "";
      const refreshToken = c.refreshToken || "";
      const refreshClaims = refreshToken ? decodeJwt(refreshToken) : null;
      const refreshExp = refreshClaims?.exp ? refreshClaims.exp * 1000 : null;

      accounts.push({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        nickname,
        domain: host,
        email: c.email || claims.email || null,
        uid: claims.sub || c.id,
        expiresAt: accessExp || null,
        refreshExpiresAt: refreshExp && refreshExp > now ? refreshExp : null,
        // auth_raw mirrors the tool's flat OAuth state for a codebuddy domain account.
        auth_raw: {
          accessToken,
          refreshToken,
          domain: host,
          tokenType: "Bearer",
          scope: claims.scope || "openid profile offline_access email",
          expiresIn: accessExp ? Math.floor((accessExp - now) / 1000) : undefined,
          refreshExpiresIn: refreshExp && refreshExp > now
            ? Math.floor((refreshExp - now) / 1000)
            : undefined,
        },
      });
    }

    return NextResponse.json(accounts);
  } catch (error) {
    console.log("Error exporting codebuddy accounts:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
