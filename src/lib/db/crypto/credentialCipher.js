// Credential encryption at rest (issue #9, item 2 — "provider secrets are stored
// as plain JSON in the database").
//
// Threat model, because it decides the design: the audit's finding is that the
// *database file* leaks wholesale — it gets backed up to a NAS, synced to a
// cloud folder, copied out for debugging, or read by an unrelated process. Every
// OAuth access/refresh token and every API key then reads out of `data` as plain
// text. This module makes those values useless without the key material.
//
// It is deliberately NOT a defence against an attacker who already has code
// execution as this user: they can read the key file too. That is what the
// planned OS-level backend (Windows DPAPI / macOS Keychain / libsecret) is for —
// it binds the key to the machine+account, so a copied data directory stays
// unreadable elsewhere. `getCredentialKey()` is the single seam for that; nothing
// else in this file needs to change.
//
// Key material: `CREDENTIAL_SECRET` (what Docker/fnOS inject) wins, otherwise a
// random key file (0600) beside the database. It is intentionally NOT stored in
// SQLite: the database is the thing that travels.
//
// Storage format: `enc:v1:<iv>:<tag>:<ciphertext>` (AES-256-GCM, base64url).
// Anything without the prefix is legacy plaintext and is returned untouched, so
// an existing database keeps working and rows get encrypted as they are written
// (plus the one-shot migration).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// Relative, not `@/lib/dataDir`: keep this module free of build aliases so any
// bundler can resolve it. The MITM bundle (`cli/scripts/buildMitm.js`) esbuilds
// `src/mitm/` with `external: []` and no `@/` mapping. It does not reach this
// module today — `server.js` is the only entry and `manager.js`, which imports us
// dynamically, is stripped from that bundle — but an aliased import would break
// the moment an entry that does reach us is added.
import { DATA_DIR } from "../../dataDir.js";
import { hardenOwnerOnly } from "../../fsPermissions.js";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_FILE = "credential-key";

// Top-level credential fields on a connection row. Everything else in `data`
// (expiry, scope, quota snapshots, model locks, …) is not secret and stays
// readable, so operators can still inspect the database.
export const CONNECTION_SECRET_FIELDS = ["accessToken", "refreshToken", "idToken", "apiKey"];

// Inside `providerSpecificData` the shape is per-provider, so match on the key
// name instead of enumerating today's fields: xiaomi-mimo already carries
// `mimoPassToken`, and a provider that starts storing a cookie should be covered
// without editing this file. `connectionProxyUrl` is included because proxy URLs
// routinely embed `user:password@`.
const NESTED_SECRET_PATTERN = /(token|secret|password|cookie|credential|api[-_]?key|proxyurl)/i;

let cachedKey = null;

export class CredentialCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function getCredentialKey() {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.CREDENTIAL_SECRET;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    cachedKey = crypto.createHash("sha256").update(fromEnv.trim()).digest();
    return cachedKey;
  }

  const file = path.join(DATA_DIR, KEY_FILE);
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw) {
      cachedKey = crypto.createHash("sha256").update(raw).digest();
      return cachedKey;
    }
  } catch {
    // missing → generate below
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  hardenOwnerOnly(file); // 0o600 is a no-op on Windows — restrict the ACL there too.
  cachedKey = crypto.createHash("sha256").update(generated).digest();
  return cachedKey;
}

// Test seam: forget the memoised key (used after changing env/CREDENTIAL_SECRET).
export function resetCredentialKeyCache() {
  cachedKey = null;
}

export function encryptSecret(plain) {
  if (typeof plain !== "string" || plain === "") return plain;
  if (isEncrypted(plain)) return plain; // already encrypted — stays idempotent
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getCredentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value) {
  if (typeof value !== "string" || !isEncrypted(value)) return value; // legacy plaintext
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new CredentialCryptoError("stored credential is malformed");
  }
  const [iv, tag, ciphertext] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getCredentialKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key (restored database without its key file / changed
    // CREDENTIAL_SECRET) or tampered ciphertext. Never return "" — that would
    // read as "no credential configured" and quietly disable the account.
    throw new CredentialCryptoError(
      "stored credential cannot be decrypted with the current key",
    );
  }
}

function nestedSecretKeys(providerSpecificData) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return [];
  return Object.keys(providerSpecificData).filter(
    (k) => NESTED_SECRET_PATTERN.test(k) && typeof providerSpecificData[k] === "string",
  );
}

// Non-empty secret-looking string values. Empty strings are skipped everywhere:
// `connectionProxyUrl` is stored as "" whenever a connection has no proxy, and
// encrypting an empty value is a no-op — counting those as "plaintext still
// present" made the Security card claim encryption had failed on a database that
// was fully encrypted.
function nonEmptyNestedSecretKeys(providerSpecificData) {
  return nestedSecretKeys(providerSpecificData).filter((k) => providerSpecificData[k] !== "");
}

// Returns a NEW object; the input is never mutated.
export function encryptConnectionData(data) {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  for (const field of CONNECTION_SECRET_FIELDS) {
    if (typeof out[field] === "string") out[field] = encryptSecret(out[field]);
  }
  const keys = nestedSecretKeys(out.providerSpecificData);
  if (keys.length) {
    const psd = { ...out.providerSpecificData };
    for (const k of keys) psd[k] = encryptSecret(psd[k]);
    out.providerSpecificData = psd;
  }
  return out;
}

// Reserved key under which a connection object carries ciphertext it could not
// decrypt. It rides along with the object (so every read/merge/write path in the
// repo keeps it without knowing) and is folded back into the row by
// `restoreUnreadableCredentials()` on the way out. Never persisted as-is.
export const UNREADABLE_CREDENTIALS_KEY = "__unreadableCredentials";

export function hasUnreadableCredentials(conn) {
  return Boolean(conn && typeof conn === "object" && conn[UNREADABLE_CREDENTIALS_KEY]);
}

// Returns `{ data, error, unreadable }`. A failed decryption must be loud but
// must not take the whole dashboard down, so the caller stores the message on
// the connection (testStatus/lastError) instead of throwing from the read path.
//
// The undecryptable values are REMOVED from `data` — a caller must never see
// ciphertext where it expects a token (it would go upstream as a Bearer and
// read as a bad credential) — but they are NOT lost: they come back in
// `unreadable` so the caller can carry them through and write them back
// unchanged. Dropping them here is how a database restored without its key file
// used to be destroyed on first start: the startup cleanup and every
// `updateProviderConnection` re-wrote the row from the decrypted object, minus
// the fields that failed, and the ciphertext was gone for good even after the
// right key was put back.
export function decryptConnectionData(data) {
  if (!data || typeof data !== "object") return { data, error: null, unreadable: null };
  const out = { ...data };
  let error = null;
  let unreadable = null;
  const remember = (scope, key, ciphertext) => {
    if (!unreadable) unreadable = {};
    if (!unreadable[scope]) unreadable[scope] = {};
    unreadable[scope][key] = ciphertext;
  };
  for (const field of CONNECTION_SECRET_FIELDS) {
    if (!isEncrypted(out[field])) continue;
    try {
      out[field] = decryptSecret(out[field]);
    } catch (err) {
      remember("fields", field, out[field]);
      delete out[field];
      error = err.message;
    }
  }
  const keys = nonEmptyNestedSecretKeys(out.providerSpecificData).filter(
    (k) => isEncrypted(out.providerSpecificData[k]),
  );
  if (keys.length) {
    const psd = { ...out.providerSpecificData };
    for (const k of keys) {
      try {
        psd[k] = decryptSecret(psd[k]);
      } catch (err) {
        remember("providerSpecificData", k, psd[k]);
        delete psd[k];
        error = err.message;
      }
    }
    out.providerSpecificData = psd;
  }
  return { data: out, error, unreadable };
}

// Inverse of the removal above, applied right before a connection object is
// serialised back into the row. For every ciphertext that could not be read:
//   * if the outgoing object carries no value for that field (unchanged, or
//     explicitly nulled by an error-state write) → put the ciphertext back, so
//     the row still holds it for whenever the right key is available again;
//   * if the outgoing object carries a NEW non-empty value → the user
//     re-authorised / re-entered the credential; the new value wins and the
//     stale ciphertext is dropped.
// `synthesized` is the { testStatus, lastError } pair `rowToConn` invented to
// make the failure visible; it is stripped again here unless a caller has
// since written something else, so the invented state never becomes durable.
// Returns a NEW object without the reserved key; the input is never mutated.
export function restoreUnreadableCredentials(data) {
  if (!data || typeof data !== "object" || !data[UNREADABLE_CREDENTIALS_KEY]) return data;
  const { [UNREADABLE_CREDENTIALS_KEY]: stash, ...out } = data;
  const isEmpty = (v) => v === undefined || v === null || v === "";

  for (const [field, ciphertext] of Object.entries(stash.fields || {})) {
    if (isEmpty(out[field])) out[field] = ciphertext;
  }
  const nested = stash.providerSpecificData || {};
  if (Object.keys(nested).length) {
    const psd = { ...(out.providerSpecificData || {}) };
    for (const [k, ciphertext] of Object.entries(nested)) {
      if (isEmpty(psd[k])) psd[k] = ciphertext;
    }
    out.providerSpecificData = psd;
  }
  const synth = stash.synthesized;
  if (synth) {
    if (out.testStatus === synth.testStatus) delete out.testStatus;
    if (out.lastError === synth.lastError) delete out.lastError;
  }
  return out;
}

// Does this connection still hold anything in the clear? Used by the migration
// and by tests to prove the whole table is covered.
export function connectionDataHasPlaintextSecrets(data) {
  if (!data || typeof data !== "object") return false;
  for (const field of CONNECTION_SECRET_FIELDS) {
    if (typeof data[field] === "string" && data[field] !== "" && !isEncrypted(data[field])) return true;
  }
  return nonEmptyNestedSecretKeys(data.providerSpecificData).some(
    (k) => !isEncrypted(data.providerSpecificData[k]),
  );
}
