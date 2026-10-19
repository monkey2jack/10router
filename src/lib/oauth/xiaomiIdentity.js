// Shared identity matching for Xiaomi MiMo connections.
//
// MiMo has two credential families (desktop account session + sk- API key) and
// several ways they arrive (QR import, browser authorization, manual key). All
// of them must resolve to ONE connection per Xiaomi account, otherwise the
// dashboard shows duplicate rows for the same uid and routing picks a row that
// lacks the credential the requested model needs.
//
// Match priority (first hit wins):
//   1. uid          — the account id the browser/desktop flow reports
//   2. mimoUserId   — the desktop-session account id (covers uid-less payloads)
//   3. email        — `${uid}@xiaomi` synthetic address
//   4. accessToken  — exact key/token reuse (same file imported twice)
//
// Every caller must go through this so the rules cannot drift apart again.

// The two cards that share the QR/browser/key flows this matcher dedups. It only
// ever runs over rows the caller already filtered to ONE of these providers, so
// accepting both cannot collapse the cards; rejecting `mimo-desktop` could not
// either — it made the Desktop import never match its own filtered rows, so every
// re-import stacked a duplicate. `xiaomi-tokenplan` deliberately stays out: its
// tp- keys are a different credential family that must never dedup into a mimo
// row.
const XIAOMI_SESSION_CARDS = new Set(["xiaomi-mimo", "mimo-desktop"]);

/**
 * @param {object} conn      candidate connection row
 * @param {{uid?: string|null, key?: string|null, mimoUserId?: string|null}} ident
 * @returns {boolean}
 */
export function matchesXiaomiIdentity(conn, ident = {}) {
  if (!conn || !XIAOMI_SESSION_CARDS.has(conn.provider)) return false;
  const { uid = null, key = null, mimoUserId = null } = ident;
  const psd = conn.providerSpecificData || {};

  if (uid && (psd.uid === uid || psd.mimoUserId === uid)) return true;
  if (uid && conn.email === `${uid}@xiaomi`) return true;
  if (mimoUserId && psd.mimoUserId === mimoUserId) return true;
  if (key && conn.accessToken === key) return true;
  return false;
}

/**
 * Find the connection that `ident` belongs to, or null.
 * @param {Array<object>} connections
 * @param {{uid?: string|null, key?: string|null, mimoUserId?: string|null}} ident
 */
export function findXiaomiConnection(connections, ident = {}) {
  return (connections || []).find((c) => matchesXiaomiIdentity(c, ident)) || null;
}
