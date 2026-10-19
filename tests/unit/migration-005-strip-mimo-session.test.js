// Migration 005 — take MiMo Desktop's account session back out of the cloud card.
//
// Pre-split builds folded mimoPassToken/mimoUserId/mimoCUserId into xiaomi-mimo
// rows, so the cloud card advertised a Desktop badge and a weekly quota it does
// not own. The migration has four outcomes, one case each here:
//   • fold (real key + copied session) → strip the session, keep the key;
//   • session-only (placeholder, no key) → move the row to mimo-desktop;
//   • session-only duplicate of a Desktop row that already owns the session → delete;
//   • undecryptable credential → leave the row byte-identical (ciphertext survives).
// Plus idempotency: a second run changes nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.CREDENTIAL_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-mig005-"));
  process.env.DATA_DIR = tempDir;
  process.env.CREDENTIAL_SECRET = "mig005-test-secret";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.CREDENTIAL_SECRET;
  else process.env.CREDENTIAL_SECRET = originalSecret;
});

const SESSION_FIELDS = ["mimoPassToken", "mimoUserId", "mimoCUserId"];

async function insert(db, id, provider, data, email = null) {
  const { encryptConnectionData } = await import("@/lib/db/crypto/credentialCipher.js");
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, provider, "oauth", id, email, 1, 1, JSON.stringify(encryptConnectionData(data)), now, now],
  );
}

// A well-formed enc:v1: payload whose auth tag cannot verify — exactly what a
// database restored without its key file looks like to decryptSecret.
function unreadableCiphertext() {
  const b64 = (n) => crypto.randomBytes(n).toString("base64url");
  return `enc:v1:${b64(12)}:${b64(16)}:${b64(32)}`;
}

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const { default: migration } = await import("@/lib/db/migrations/005-strip-mimo-main-card-session.js");
  return { db, migration };
}

async function rawRow(db, id) {
  return db.get(`SELECT provider, data FROM providerConnections WHERE id = ?`, [id]);
}

describe("005-strip-mimo-main-card-session", () => {
  it("strips the folded session from a key-backed cloud row, keeping the key", async () => {
    const { db, migration } = await boot();
    await insert(db, "c-fold", "xiaomi-mimo", {
      accessToken: "sk-real-key-1",
      providerSpecificData: {
        mimoPassToken: "pt-secret",
        mimoUserId: "6786673",
        mimoCUserId: "c-9",
        provider: "Xiaomi MiMo Desktop Session",
        authMethod: "desktop-session",
        region: "cn",
      },
    });

    migration.up(db);

    const { getProviderConnectionById } = await import("@/lib/db/repos/connectionsRepo.js");
    const conn = await getProviderConnectionById("c-fold");
    expect(conn.provider).toBe("xiaomi-mimo");
    expect(conn.accessToken).toBe("sk-real-key-1");
    for (const f of SESSION_FIELDS) expect(conn.providerSpecificData[f]).toBeUndefined();
    expect(conn.providerSpecificData.provider).toBeUndefined();
    expect(conn.providerSpecificData.authMethod).toBe("api_key");
    expect(conn.providerSpecificData.region).toBe("cn"); // non-session fields survive
  });

  it("moves a session-only cloud row to the Desktop card", async () => {
    const { db, migration } = await boot();
    await insert(db, "c-only", "xiaomi-mimo", {
      accessToken: "mimo-desktop-session-6786673",
      providerSpecificData: { mimoPassToken: "pt-secret", uid: "6786673", authMethod: "desktop-session" },
    }, "6786673@xiaomi");

    migration.up(db);

    const row = await rawRow(db, "c-only");
    expect(row.provider).toBe("mimo-desktop");
    // The credential is what the Desktop card needs — it must still decrypt.
    const { getProviderConnectionById } = await import("@/lib/db/repos/connectionsRepo.js");
    const conn = await getProviderConnectionById("c-only");
    expect(conn.providerSpecificData.mimoPassToken).toBe("pt-secret");
  });

  it("deletes a session-only duplicate when the Desktop row already owns the account", async () => {
    const { db, migration } = await boot();
    await insert(db, "d-real", "mimo-desktop", {
      accessToken: "mimo-desktop-session",
      providerSpecificData: { mimoPassToken: "pt-home", mimoUserId: "555" },
    });
    await insert(db, "c-dup", "xiaomi-mimo", {
      accessToken: "mimo-desktop-session-555",
      providerSpecificData: { mimoPassToken: "pt-stale", mimoUserId: "555" },
    });

    migration.up(db);

    expect(await rawRow(db, "c-dup")).toBeFalsy();
    expect((await rawRow(db, "d-real")).provider).toBe("mimo-desktop");
  });

  it("leaves a row with undecryptable credentials byte-identical", async () => {
    const { db, migration } = await boot();
    const bad = unreadableCiphertext();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "c-broken", "xiaomi-mimo", "oauth", "c-broken", null, 1, 1,
        JSON.stringify({ accessToken: bad, providerSpecificData: { mimoPassToken: "pt" } }),
        new Date().toISOString(), new Date().toISOString(),
      ],
    );
    const before = await rawRow(db, "c-broken");

    migration.up(db);

    expect(await rawRow(db, "c-broken")).toEqual(before); // ciphertext survives for the right key
  });

  it("is idempotent and leaves clean rows alone", async () => {
    const { db, migration } = await boot();
    await insert(db, "c-fold2", "xiaomi-mimo", {
      accessToken: "sk-two",
      providerSpecificData: { mimoPassToken: "pt", apiKey: "sk-two" },
    });
    await insert(db, "c-clean", "xiaomi-mimo", {
      accessToken: "sk-clean",
      providerSpecificData: { region: "cn" },
    });

    migration.up(db);
    const afterFirst = await rawRow(db, "c-fold2");
    const cleanFirst = await rawRow(db, "c-clean");
    migration.up(db);

    expect(await rawRow(db, "c-fold2")).toEqual(afterFirst);
    expect(await rawRow(db, "c-clean")).toEqual(cleanFirst);
    // ...and the first run actually did the strip
    const { getProviderConnectionById } = await import("@/lib/db/repos/connectionsRepo.js");
    const conn = await getProviderConnectionById("c-fold2");
    expect(conn.providerSpecificData.mimoPassToken).toBeUndefined();
    expect(conn.providerSpecificData.region).toBeUndefined(); // was never there
    expect(conn.providerSpecificData.apiKey).toBe("sk-two");
  });
});
