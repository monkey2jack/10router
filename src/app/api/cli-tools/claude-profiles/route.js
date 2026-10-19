"use server";

import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { sanitizeProfileInput, upsertProfile, removeProfile } from "@/lib/cliToolProfiles";

// CRUD for the CLI-tools model-combo profiles (issue #17), stored under the
// `cliToolProfiles` settings key. Auth comes from the dashboard guard's
// catch-all (same as /api/cli-tools/claude-settings).

const readProfiles = async () => {
  const settings = await getSettings();
  return Array.isArray(settings.cliToolProfiles) ? settings.cliToolProfiles : [];
};

export async function GET() {
  try {
    return NextResponse.json({ profiles: await readProfiles() });
  } catch (error) {
    console.log("Error listing cli-tool profiles:", error);
    return NextResponse.json({ error: "Failed to list profiles" }, { status: 500 });
  }
}

// Create (no id) or update (id of an existing profile).
export async function POST(request) {
  try {
    const body = await request.json();
    const sanitized = sanitizeProfileInput(body);
    if (!sanitized.ok) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }

    const profiles = await readProfiles();
    const result = upsertProfile(profiles, sanitized.profile, {
      id: body?.id ? String(body.id) : undefined,
      newId: () =>
        globalThis.crypto?.randomUUID?.() ||
        `prof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: body?.id ? 404 : 400 });
    }

    await updateSettings({ cliToolProfiles: result.profiles });
    return NextResponse.json({ profile: result.profile });
  } catch (error) {
    console.log("Error saving cli-tool profile:", error);
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Profile id is required" }, { status: 400 });
    }
    const profiles = await readProfiles();
    const { profiles: next, removed } = removeProfile(profiles, id);
    if (!removed) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    await updateSettings({ cliToolProfiles: next });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting cli-tool profile:", error);
    return NextResponse.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
