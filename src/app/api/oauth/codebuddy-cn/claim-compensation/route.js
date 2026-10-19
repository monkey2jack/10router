import { NextResponse } from "next/server";

/**
 * POST /api/oauth/codebuddy-cn/claim-compensation
 * Trigger a manual CodeBuddy CN compensation & gift claim for all active codebuddy-cn
 * connections, and return per-account results.
 *
 * Safe, idempotent, and guarded by dashboard session authentication.
 */
export async function POST() {
  try {
    const { runCodebuddyCompensationTick } = await import(
      "@/sse/services/codebuddyCheckin.js"
    );
    const results = await runCodebuddyCompensationTick();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.log("Error running CodeBuddy CN compensation claim:", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
