import { NextResponse } from "next/server";
import { getEgressRegion } from "@/lib/network/egressRegion";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getEgressRegion();
    return NextResponse.json(data || { countryCode: null, recommendedRegions: {} });
  } catch (error) {
    return NextResponse.json({ error: "Failed to detect egress region" }, { status: 500 });
  }
}
