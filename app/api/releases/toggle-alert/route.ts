import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ReleaseAlertPref = {
  set_id: string;
  enabled: boolean;
};

export async function GET(req: Request) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const setIds = (searchParams.get("setIds") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (setIds.length === 0) {
    return NextResponse.json({ prefs: {} });
  }

  const { data, error } = await supabase
    .from("release_alert_prefs")
    .select("set_id, enabled")
    .in("set_id", setIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const prefs = Object.fromEntries(
    ((data ?? []) as ReleaseAlertPref[]).map(pref => [pref.set_id, pref.enabled])
  );

  return NextResponse.json({ prefs });
}

export async function POST(req: Request) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { setId, enabled } = body as { setId?: unknown; enabled?: unknown };
  if (typeof setId !== "string" || setId.trim() === "" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Expected setId string and enabled boolean" }, { status: 400 });
  }

  const { error } = await supabase
    .from("release_alert_prefs")
    .upsert({
      set_id: setId,
      enabled,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, setId, enabled });
}
