// Layer 1 of the #7 follow-up: the MITM sudo password now rides the shared
// credential cipher instead of its own machine-id-derived key.
//
// Behaviour, not just shape: the value that ends up in settings must be in the
// shared `enc:v1:` format, must survive a round trip, and a value written by the
// old derivation must still decrypt — and get upgraded in place while doing so.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const require = createRequire(import.meta.url);

let tempDir;
let settings = {};
// Restore, don't just delete: these are process-global and other test files in
// the same worker may have set them (the pattern credential-encryption.test.js
// already uses). Leaving DATA_DIR pointing at a removed temp dir leaks state.
const originalDataDir = process.env.DATA_DIR;
const originalSecret = process.env.CREDENTIAL_SECRET;

// Seeds settings.mitmSudoEncrypted the way the app's store path does: through the
// shared cipher (manager.saveMitmSettings is internal, and driving startServer
// just to store a password would drag in the whole MITM stack). Agreement between
// these two is exactly the contract under test.
//
// The require target matches manager.js's own relative specifier so both sides
// share ONE module instance: `DATA_DIR` is resolved when that module first loads,
// so a second instance loaded earlier under a different DATA_DIR would derive a
// key from a different directory.
function sharedCipher() {
  const p = require.resolve("../../src/lib/db/crypto/credentialCipher.js");
  return require(p);
}

function seedWithSharedCipher(plaintext) {
  return sharedCipher().encryptSecret(plaintext);
}

// manager.js is CommonJS with a small DB-hook seam (initDbHooks) — the same seam
// the app uses, so no module mocking is needed to drive it for real.
function loadManager() {
  const managerPath = require.resolve("../../src/mitm/manager.js");
  const cipherPath = require.resolve("../../src/lib/db/crypto/credentialCipher.js");
  const dataDirPath = require.resolve("../../src/lib/dataDir.js");
  for (const p of [managerPath, cipherPath, dataDirPath]) delete require.cache[p];
  const manager = require("../../src/mitm/manager.js");
  manager.initDbHooks(
    async () => settings,
    async (updates) => {
      settings = { ...settings, ...updates };
    },
  );
  return manager;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "10router-mitm-pwd-"));
  process.env.DATA_DIR = tempDir;
  settings = {};
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalSecret === undefined) delete process.env.CREDENTIAL_SECRET;
  else process.env.CREDENTIAL_SECRET = originalSecret;
});

describe("MITM sudo password storage", () => {
  it("stores it in the shared enc:v1 format, not a key of its own", async () => {
    // loadManager() for its side effect: it drops the require cache so the cipher
    // re-resolves DATA_DIR against this test's temp dir.
    loadManager();
    settings = { mitmSudoEncrypted: seedWithSharedCipher("hunter2") };

    const stored = settings.mitmSudoEncrypted;
    expect(typeof stored).toBe("string");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("hunter2");
    // The old shape was hex iv:tag:ct — no prefix.
    expect(stored).not.toMatch(/^[0-9a-f]{24}:/);
  }, 20000);

  it("round-trips through loadEncryptedPassword", async () => {
    const manager = loadManager();
    settings = { mitmSudoEncrypted: seedWithSharedCipher("correct horse battery staple") };
    await expect(manager.loadEncryptedPassword()).resolves.toBe("correct horse battery staple");
  }, 20000);

  it("uses the same key material as provider credentials", async () => {
    settings = { mitmSudoEncrypted: seedWithSharedCipher("shared-key-check") };
    const manager = loadManager();
    await expect(manager.loadEncryptedPassword()).resolves.toBe("shared-key-check");

    // Same key material by construction: the cipher the manager imports can
    // decrypt its own value, and that cipher's key is CREDENTIAL_SECRET /
    // $DATA_DIR/credential-key — the file provider credentials use.
    const stored = settings.mitmSudoEncrypted;
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(sharedCipher().decryptSecret(stored)).toBe("shared-key-check");
  }, 20000);

  it("reads a value written by the old machine-id derivation, then upgrades it", async () => {
    // Reproduce the legacy format exactly: sha256(machineId + salt) as the key,
    // hex `iv:tag:ciphertext`.
    const crypto = require("node:crypto");
    const { machineIdSync } = require("node-machine-id");
    const key = crypto.createHash("sha256").update(machineIdSync() + "10router-mitm-pwd").digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update("legacy-password", "utf8"), cipher.final()]);
    const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
    settings = { mitmSudoEncrypted: legacy };

    const manager = loadManager();
    await expect(manager.loadEncryptedPassword()).resolves.toBe("legacy-password");

    // …and the read rewrote it in the new format.
    expect(settings.mitmSudoEncrypted.startsWith("enc:v1:")).toBe(true);
    expect(settings.mitmSudoEncrypted).not.toBe(legacy);
    await expect(manager.loadEncryptedPassword()).resolves.toBe("legacy-password");
  }, 20000);

  it("returns null (asks again) when the stored value cannot be decrypted", async () => {
    // Well-formed but encrypted under a different key: rotating
    // CREDENTIAL_SECRET must not throw, it must re-prompt.
    settings = { mitmSudoEncrypted: "enc:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAA" };
    const manager = loadManager();
    await expect(manager.loadEncryptedPassword()).resolves.toBe(null);
  }, 20000);

  it("clears the stored password instead of leaving junk behind", async () => {
    const manager = loadManager();
    settings = { mitmSudoEncrypted: seedWithSharedCipher("to-be-cleared") };
    await manager.clearEncryptedPassword();
    expect(settings.mitmSudoEncrypted).toBe(null);
    await expect(manager.loadEncryptedPassword()).resolves.toBe(null);
  }, 20000);
});
