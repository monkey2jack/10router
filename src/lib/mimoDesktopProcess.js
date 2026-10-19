// MiMo Desktop process control (status + force-quit), used by the dashboard's
// Desktop-card detection flow: a running Desktop holds its cookie store under
// an exclusive lock (see open-sse/shared/mimoAccount.js), which blocks the
// credential read until the app is closed. The operator can now close it from
// the modal instead of hunting for the tray icon.
//
// Process identity: the Windows image name and the macOS bundle path both come
// from the verified install ("Xiaomi MiMo.exe" / "Xiaomi MiMo.app" — same
// product name as the Electron userData dir "Xiaomi MiMo").

import { execFile } from "node:child_process";

const WIN_IMAGE = "Xiaomi MiMo.exe";
const DARWIN_MATCH = "Xiaomi MiMo.app/Contents/MacOS";

function exec(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout: String(stdout || ""), stderr: String(stderr || ""), err: Boolean(err) });
    });
  });
}

/** Is a MiMo Desktop process running on THIS machine? */
export async function isDesktopProcessRunning() {
  try {
    if (process.platform === "win32") {
      const { stdout } = await exec("tasklist", ["/FI", `IMAGENAME eq ${WIN_IMAGE}`, "/FO", "CSV", "/NH"]);
      // CSV rows only appear when a matching process exists; the filter-miss
      // case prints a localized "no tasks" INFO line instead.
      const running = stdout.includes(WIN_IMAGE);
      return { running, platform: "win32" };
    }
    if (process.platform === "darwin") {
      const { stdout } = await exec("pgrep", ["-f", DARWIN_MATCH]);
      const pids = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      return { running: pids.length > 0, pids, platform: "darwin" };
    }
    return { running: false, platform: process.platform, unsupported: true };
  } catch (e) {
    return { running: false, error: e?.message || String(e) };
  }
}

/**
 * Force-quit MiMo Desktop on THIS machine (tree-kill on Windows so the bundled
 * mimocode engine goes down with it). Returns { killed, detail } — `killed` is
 * best-effort: callers re-run the credential detection afterwards and treat a
 * still-locked store as "not closed".
 */
export async function killDesktopProcess() {
  try {
    if (process.platform === "win32") {
      const { stdout, stderr } = await exec("taskkill", ["/F", "/T", "/IM", WIN_IMAGE]);
      const out = `${stdout}\n${stderr}`;
      const killed = /SUCCESS|成功/i.test(out);
      return { killed, detail: out.trim().slice(0, 400), platform: "win32" };
    }
    if (process.platform === "darwin") {
      const first = await exec("pkill", ["-f", DARWIN_MATCH]);
      if (first.code === 0) {
        // Give Chromium a beat to release the cookie store, then confirm.
        await new Promise((r) => setTimeout(r, 800));
        const check = await isDesktopProcessRunning();
        return { killed: !check.running, detail: "SIGTERM sent", platform: "darwin" };
      }
      return { killed: false, detail: "no matching process", platform: "darwin" };
    }
    return { killed: false, error: `unsupported platform: ${process.platform}` };
  } catch (e) {
    return { killed: false, error: e?.message || String(e) };
  }
}
