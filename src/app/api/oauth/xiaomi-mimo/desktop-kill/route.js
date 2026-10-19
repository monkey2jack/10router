import { NextResponse } from "next/server";
import { isDesktopProcessRunning, killDesktopProcess } from "@/lib/mimoDesktopProcess";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/xiaomi-mimo/desktop-kill
 * Force-quit the local MiMo Desktop process (tree-kill) so its exclusive
 * cookie-store lock releases and the credential detection can read the
 * passToken. Same-machine only (the dashboard guard enforces it); the modal
 * re-runs detection right after and reports the outcome from THERE — a still-
 * locked store after a "successful" kill means something else holds it.
 */
export async function POST() {
  const before = await isDesktopProcessRunning();
  if (!before.running) {
    return NextResponse.json({ success: true, killed: false, wasRunning: false, status: before });
  }
  const result = await killDesktopProcess();
  // Small settle so the file lock actually releases before the caller re-detects.
  await new Promise((r) => setTimeout(r, 600));
  const after = await isDesktopProcessRunning();
  return NextResponse.json({
    success: true,
    killed: !after.running,
    wasRunning: true,
    before,
    after,
    detail: result.detail || result.error || null,
  });
}
