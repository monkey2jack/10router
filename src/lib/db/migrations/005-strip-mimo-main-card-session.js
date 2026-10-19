// Take the Desktop account session back out of the xiaomi-mimo (cloud) card.
//
// Before the 1.2.0 three-card split was enforced everywhere, both write paths
// (browser /exchange and the api-key / auto-import routes) folded MiMo
// Desktop's account session — mimoPassToken/mimoUserId/mimoCUserId — into
// xiaomi-mimo rows. The effect: the cloud card advertised a "Desktop Session"
// badge it does not own and rendered the Desktop weekly quota, when that card
// is exactly the one that bills through the sk- key. The routes now gate the
// fold on the Desktop card; this cleans up the rows they (and pre-split builds)
// already wrote.
//
// Two shapes arrive here:
//   • the fold case — the row holds a REAL key plus a copied session. The
//     session and the Desktop label are stripped; the key stays.
//   • the session-only case (pre-split Desktop imports, pre-fix cloud
//     session-only imports) — placeholder accessToken, no key at all. That row
//     can serve nothing on the cloud card, and its credential legitimately
//     belongs to the Desktop card: move it to `mimo-desktop`. If the Desktop
//     card already holds the same account WITH a usable passToken, the cloud
//     row is a stale duplicate and is deleted instead.
//
// Nothing is ever destroyed blindly: a row whose credential cannot be
// decrypted with the current key (database restored without its key file) is
// skipped, so the ciphertext survives for the day the right key returns — the
// same property migration 003 had to learn the hard way.
//
// Idempotent: once stripped/moved the rows no longer match, and the framework
// stamps schemaVersion so this runs once. Fail-open: any row it cannot
// understand is left alone.

import {
  isEncrypted,
  decryptSecret,
  encryptConnectionData,
} from "../crypto/credentialCipher.js";

const SESSION_FIELDS = ["mimoPassToken", "mimoUserId", "mimoCUserId"];
// The psd labels the old write paths used to mark a Desktop-derived row.
// Grep-verified: nothing reads psd.provider, so removal is display-neutral.
const DESKTOP_LABELS = new Set(["Xiaomi MiMo Desktop", "Xiaomi MiMo Desktop Session"]);
const SESSION_PLACEHOLDER_PREFIX = "mimo-desktop-session";

// `{ ok, value }` — value stays the original string when `ok` is false, so a
// caller that merely wants to preserve it changes nothing.
function unwrap(value) {
  if (!isEncrypted(value)) return { ok: true, value };
  try {
    return { ok: true, value: decryptSecret(value) };
  } catch {
    return { ok: false, value };
  }
}

function parseData(row) {
  try {
    return JSON.parse(row.data || "{}");
  } catch {
    return null;
  }
}

// Comparable identity of a MiMo row. Undecryptable fields come back null so a
// comparison never matches on ciphertext (AES-GCM IVs make it non-reproducible
// anyway); the MOVE-vs-DELETE decision then falls to the safe side (move).
// `email` is passed in because it lives in its own column — the JSON blob the
// repo encrypts has it destructured out (see connectionsRepo.connToRow).
function identityOf(data, email = null) {
  const psd = data?.providerSpecificData || {};
  const acc = unwrap(typeof data?.accessToken === "string" ? data.accessToken : null);
  const uid = typeof psd.uid === "string" || typeof psd.uid === "number" ? String(psd.uid) : null;
  const mu =
    typeof psd.mimoUserId === "string" || typeof psd.mimoUserId === "number"
      ? String(psd.mimoUserId)
      : null;
  const pt = psd.mimoPassToken;
  return {
    token: acc.ok ? acc.value : null,
    uid,
    mu,
    email: typeof email === "string" && email ? email : null,
    // A Desktop row "owns" the account session only if a passToken is present
    // AND readable (or plain-stored and non-empty).
    hasSession: pt !== undefined && pt !== null && pt !== "" && unwrap(pt).ok,
  };
}

function sameIdentity(a, b) {
  if (a.token && b.token && a.token === b.token) return true;
  if (a.uid && b.uid && a.uid === b.uid) return true;
  if (a.mu && b.mu && a.mu === b.mu) return true;
  // uid and mimoUserId are the same Xiaomi account id under two field names.
  if (a.uid && b.mu && a.uid === b.mu) return true;
  if (a.mu && b.uid && a.mu === b.uid) return true;
  if (a.email && b.email && a.email === b.email) return true;
  return false;
}

function withoutSession(psd) {
  const out = { ...psd };
  for (const k of SESSION_FIELDS) delete out[k];
  if (DESKTOP_LABELS.has(out.provider)) delete out.provider;
  return out;
}

export default {
  version: 5,
  name: "strip-mimo-main-card-session",
  up(db) {
    let cloudRows;
    let desktopRows;
    try {
      // email lives in its own column (the repo destructures it out of the JSON
      // blob), so identity comparison has to read it from there.
      cloudRows = db.all(`SELECT id, email, data FROM providerConnections WHERE provider = 'xiaomi-mimo'`);
      desktopRows = db.all(`SELECT id, email, data FROM providerConnections WHERE provider = 'mimo-desktop'`);
    } catch (err) {
      console.warn("[migration] strip-mimo-main-card-session: could not read connections:", err?.message || err);
      return;
    }

    const desktopIdents = desktopRows
      .map((row) => {
        const data = parseData(row);
        return data ? identityOf(data, row.email) : null;
      })
      .filter(Boolean);
    let stripped = 0;
    let moved = 0;
    let removed = 0;
    let preserved = 0;

    for (const row of cloudRows) {
      const data = parseData(row);
      if (!data || typeof data !== "object") continue;
      const psd = data.providerSpecificData && typeof data.providerSpecificData === "object"
        ? data.providerSpecificData
        : {};

      const hasSessionField = SESSION_FIELDS.some((k) => psd[k] !== undefined && psd[k] !== null && psd[k] !== "");
      const contaminated =
        hasSessionField ||
        DESKTOP_LABELS.has(psd.provider) ||
        psd.authMethod === "desktop-session" ||
        (typeof data.accessToken === "string" && data.accessToken.startsWith(SESSION_PLACEHOLDER_PREFIX));
      if (!contaminated) continue;

      // Readability first: the row's own accessToken decides the branch, and a
      // passToken we cannot read must not be deleted.
      const acc = unwrap(typeof data.accessToken === "string" ? data.accessToken : null);
      if (!acc.ok) {
        preserved += 1;
        continue;
      }
      if (psd.mimoPassToken && !unwrap(psd.mimoPassToken).ok) {
        preserved += 1;
        continue;
      }

      const isPlaceholder =
        typeof acc.value !== "string" || acc.value === "" || acc.value.startsWith(SESSION_PLACEHOLDER_PREFIX);

      if (!isPlaceholder) {
        // The fold case: a key-backed cloud row. Strip the session half; the
        // authMethod may still claim "desktop-session" from a session-only
        // import that later gained a key — with the session gone it is a key.
        const cleaned = withoutSession(psd);
        if (cleaned.authMethod === "desktop-session") cleaned.authMethod = "api_key";
        db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [
          JSON.stringify(encryptConnectionData({ ...data, providerSpecificData: cleaned })),
          row.id,
        ]);
        stripped += 1;
        continue;
      }

      // The session-only case: nothing on the cloud card this row can serve.
      // The Desktop card is its real home.
      const me = identityOf(data, row.email);
      const owned = desktopIdents.find((d) => sameIdentity(d, me) && d.hasSession);
      if (owned) {
        db.run(`DELETE FROM providerConnections WHERE id = ?`, [row.id]);
        removed += 1;
        continue;
      }
      db.run(`UPDATE providerConnections SET provider = 'mimo-desktop', data = ? WHERE id = ?`, [
        // Keep the row's contents intact — on the Desktop card the session is
        // the credential. Re-encrypt so the write is at-rest-safe either way.
        JSON.stringify(encryptConnectionData(data)),
        row.id,
      ]);
      moved += 1;
    }

    if (stripped || moved || removed || preserved) {
      console.log(
        `[migration] strip-mimo-main-card-session: stripped ${stripped} cloud row(s), ` +
          `moved ${moved} session-only row(s) to mimo-desktop, ` +
          `removed ${removed} duplicate row(s)` +
          (preserved ? `, ${preserved} row(s) left untouched (undecryptable credentials)` : ""),
      );
    }
  },
};
