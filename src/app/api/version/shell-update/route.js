import { NextResponse } from "next/server";
import { writeUpdateRequest } from "@/lib/updateCheck";

// Dashboard → desktop-shell update handoff. The shell's sidecar is started with
// INSTALL_CHANNEL=desktop; on that channel the tray shell owns the download /
// SHA256 / install flow (see desktop/updateRequest.js, which consumes the
// marker this writes). npm/Docker/fpk have no shell waiting on the marker, so
// they are refused outright rather than letting the user click a button that
// silently does nothing. Guarding: "/api/version" is a local-or-auth prefix in
// src/dashboardGuard.js, but this — like /api/version/shutdown — is state
// changing, so it is listed in ALWAYS_PROTECTED explicitly.
export async function POST(request) {
  if (process.env.INSTALL_CHANNEL !== "desktop") {
    return NextResponse.json(
      { success: false, message: "Only the desktop install (tray shell) can take over from here — download the installer from the release page instead." },
      { status: 403 }
    );
  }

  // version is informational (shell logs, debugging); the shell re-resolves the
  // real target from GitHub. Unknown shapes are dropped rather than stored.
  let version = "";
  try {
    const body = await request.json();
    if (typeof body?.version === "string") version = body.version;
  } catch { /* empty / non-JSON body is fine — the request carries no authority */ }
  if (!/^[0-9A-Za-z.+-]{1,32}$/.test(version)) version = "";

  try {
    writeUpdateRequest(version ? { version } : {});
  } catch {
    return NextResponse.json(
      { success: false, message: "Could not write the update request file." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Desktop shell notified — confirm the download in its update window (system tray).",
  });
}
