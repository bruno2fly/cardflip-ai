import { NextRequest, NextResponse } from "next/server";
import { setDropWindows, type DropWindow } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Replace the drop-window list (the /bot page manages add/remove client-side
 * and POSTs the full array). Windows are local-time ISO strings without UTC
 * offset - the monitor compares them against its own local clock, so a
 * browser in NY scheduling a 3 AM window means 3 AM on the Mac mini too
 * (both machines live in the same TZ; keep them that way or add offsets).
 */

export async function POST(req: NextRequest) {
  let body: { windows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.windows)) {
    return NextResponse.json({ error: "windows (array) required" }, { status: 400 });
  }

  const windows: DropWindow[] = [];
  for (const raw of body.windows) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "each window must be an object" }, { status: 400 });
    }
    const w = raw as { start?: unknown; end?: unknown; intervalSec?: unknown };
    const start = typeof w.start === "string" ? w.start.trim() : "";
    const end = typeof w.end === "string" ? w.end.trim() : "";
    if (!start || !end) {
      return NextResponse.json({ error: "each window needs start and end" }, { status: 400 });
    }
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) {
      return NextResponse.json({ error: `unparseable dates: ${start} / ${end}` }, { status: 400 });
    }
    if (s >= e) {
      return NextResponse.json({ error: "start must be before end" }, { status: 400 });
    }
    const intervalSec = Number(w.intervalSec ?? 15);
    windows.push({
      start,
      end,
      intervalSec: Math.min(60, Math.max(5, Number.isFinite(intervalSec) ? intervalSec : 15)),
    });
  }

  const ok = await setDropWindows(windows);
  if (!ok) {
    return NextResponse.json(
      { error: "supabase not configured or update failed — run supabase/bot_orders.sql (drop_windows column)" },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, windows });
}
