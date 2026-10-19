// Restrict a just-written secret file to the owning account only (issue #9, item 7).
//
// POSIX: chmod 0600. Windows: POSIX mode bits are a no-op there, and a file created
// under the user profile inherits ACLs that usually include Users / Authenticated
// Users — so a secret key file sits readable by anyone who can reach the path.
// `icacls /inheritance:r` drops the inherited entries; a single explicit (F) grant
// to the owning account replaces them.
//
// Best-effort by design: warn, never throw. A broken app is worse than a permissive
// key, and the warning tells the operator. Node builtins only and no build aliases,
// so bundler-agnostic callers (e.g. credentialCipher.js) can import it freely.
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";

export function hardenOwnerOnly(filePath) {
  if (!filePath) return;

  if (process.platform === "win32") {
    try {
      const account =
        [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join("\\") || os.userInfo().username;
      // (F) = full control for the owner. (R,W) omits DELETE, which breaks any path
      // that later unlinks its own key file (e.g. the Root CA regeneration path).
      execFileSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${account}:(F)`], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (e) {
      console.warn(`⚠️  Could not restrict ACLs on ${filePath}: ${e.message}`);
    }
    return;
  }

  try {
    fs.chmodSync(filePath, 0o600);
  } catch (e) {
    console.warn(`⚠️  Could not restrict permissions on ${filePath}: ${e.message}`);
  }
}
