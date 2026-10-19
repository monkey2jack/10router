import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { getDataDir } from "@/lib/dataDir.js";
import { updateSettings } from "@/lib/localDb";

// Recovery entry for a forgotten / unusable dashboard password (issue #33).
//
// Put a file named `reset-password` in the data directory — any trailing
// extension is accepted too (`reset-password.txt`, `.md`, …): Windows Explorer
// makes extensionless files awkward to create and hides extensions by default,
// so the file people end up with almost always has one. The extensionless name
// wins when several exist; the rest are tried in alphabetical order.
//   - with a password in it  → that becomes the dashboard password
//   - empty                  → the stored password is removed and log-in falls back
//                              to the first-login password (INITIAL_PASSWORD /
//                              fnOS initial-password) — or, with none, to
//                              "set one on this machine"
// The file is consumed on the next server start or the next log-in attempt (no
// restart needed) and deleted before anything else, so the plaintext does not
// linger. Only someone who can write to the data directory can use it — and that
// person can already read the whole database, so it grants nothing new.
// fnOS writes the extensionless one from App Center → 10Router → 应用设置
// (cmd/config_callback). Full spec: docs/zh-CN/dashboard-password-recovery.md.
export const PASSWORD_RESET_FILE = "reset-password";

// Reset-file candidates, best first: exact name, then every `reset-password.*`
// alphabetically (deterministic when several linger). `reset-password-old`
// style names do NOT match — the dot is required.
function findResetFile(dataDir) {
  let names;
  try {
    names = fs
      .readdirSync(dataDir)
      .filter((n) => n === PASSWORD_RESET_FILE || n.startsWith(`${PASSWORD_RESET_FILE}.`))
      .sort((a, b) => (a === PASSWORD_RESET_FILE ? -1 : b === PASSWORD_RESET_FILE ? 1 : a.localeCompare(b)));
  } catch {
    return [];
  }
  return names.map((n) => path.join(dataDir, n));
}

export async function applyPasswordResetFile() {
  let file = null;
  let content = null;
  for (const candidate of findResetFile(getDataDir())) {
    try {
      content = fs.readFileSync(candidate, "utf8"); // skips directories, unreadables
      file = candidate;
      break;
    } catch { /* try the next name */ }
  }
  if (!file) return null; // no reset requested
  try {
    fs.rmSync(file, { force: true });
  } catch (e) {
    console.warn(`[auth] could not delete ${file} after reading it — remove it by hand: ${e.message}`);
  }

  const newPassword = content.trim();
  if (!newPassword) {
    await updateSettings({ password: null });
    console.log("[auth] dashboard password removed via reset-password file (first-login password applies again)");
    return "cleared";
  }
  const hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
  await updateSettings({ password: hash });
  console.log("[auth] dashboard password replaced via reset-password file");
  return "set";
}
