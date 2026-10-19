// hardenOwnerOnly (issue #9 item 7): secret key files must be owner-only on
// every platform — 0o600 on POSIX, an explicit ACL on Windows where mode bits
// are a no-op. The helper is best-effort (warns, never throws).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hardenOwnerOnly } from "../../src/lib/fsPermissions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("hardenOwnerOnly", () => {
  it("is a no-op (never throws) on a null / missing path", () => {
    expect(() => hardenOwnerOnly(null)).not.toThrow();
    expect(() => hardenOwnerOnly(path.join(os.tmpdir(), `10r-nope-${process.pid}`))).not.toThrow();
  });

  it("restricts a real secret file without throwing", () => {
    const f = path.join(os.tmpdir(), `10r-hardentest-${process.pid}-${Date.now()}`);
    fs.writeFileSync(f, "secret", { mode: 0o600 });
    try {
      expect(() => hardenOwnerOnly(f)).not.toThrow();
      if (process.platform !== "win32") {
        expect(fs.statSync(f).mode & 0o777).toBe(0o600);
      }
    } finally {
      fs.rmSync(f, { force: true });
    }
  });

  it("both credential key-file writers harden after writing (source)", () => {
    const cipher = fs.readFileSync(path.join(ROOT, "src/lib/db/crypto/credentialCipher.js"), "utf8");
    const session = fs.readFileSync(path.join(ROOT, "src/lib/auth/dashboardSession.js"), "utf8");
    expect(cipher).toMatch(/hardenOwnerOnly\(file\)/);
    expect(session).toMatch(/hardenOwnerOnly\(file\)/);
  });
});
