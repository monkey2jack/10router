import { NextResponse } from "next/server";
import { isDesktopProcessRunning } from "@/lib/mimoDesktopProcess";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/xiaomi-mimo/desktop-status
 * Whether a MiMo Desktop process is running on THIS machine (its cookie store
 * would be exclusively locked). The dashboard guard lets same-machine requests
 * through; remote callers fall back to the ALWAYS_PROTECTED auth set.
 */
export async function GET() {
  const status = await isDesktopProcessRunning();
  return NextResponse.json(status);
}
