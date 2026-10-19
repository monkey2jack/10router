import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir.js";

// Settings → Security → "Check for updates automatically". Some operators pin a
// version on purpose; with this off nothing phones the npm registry on its own.
// Explicit checks (the "Check now" button, the tray's "Check for updates") still
// work — they call /api/version?check=1.
//
// The CLI launcher runs its own registry check before the server is up, so it
// cannot read the setting. It looks for this marker in the data dir instead
// (cli/cli.js checkForUpdate) — keep the file name in sync there.
export const UPDATE_CHECK_DISABLED_MARKER = "update-check-disabled";

export function isAutoUpdateCheckEnabled(settings) {
  return settings?.autoUpdateCheck !== false;
}

// Mirror the setting into the marker. Best-effort: a read-only data dir only
// means the launcher keeps checking, the dashboard still honours the setting.
export function syncUpdateCheckMarker(enabled) {
  const file = path.join(getDataDir(), UPDATE_CHECK_DISABLED_MARKER);
  try {
    if (enabled) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, "Automatic update checks are off (Settings → Security).\n");
  } catch { /* best effort */ }
}

// ───────────────────────────────────────────────────────────────────────────
// Dashboard → desktop-shell update handoff. On a desktop install the tray shell
// owns the full check → download → SHA256 → install flow, but a dashboard page
// cannot reach Electron. Contract: this side drops a one-shot marker file in
// the data dir; the shell (desktop/updateRequest.js) polls, consumes and runs
// its own checkForUpdates(). Same pattern as the reset-password marker. File
// name and JSON shape must stay in sync with desktop/updateRequest.js; the
// consumer drops requests older than 15 minutes.
export const UPDATE_REQUEST_FILE = "update-request.json";

export function writeUpdateRequest({ version } = {}) {
  const file = path.join(getDataDir(), UPDATE_REQUEST_FILE);
  const payload = { version: version || "", requestedAt: Date.now() };
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}
