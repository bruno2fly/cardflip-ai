import { NextRequest, NextResponse } from "next/server";
import { setBotArmed } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Master arm switch for the Buy Bot. The Mac mini reads `armed` on every
 * heartbeat (~5s), so flipping this off stops buying within seconds even
 * mid-run (the buyer checks arm state before placing the order).
 */

export async function POST(req: NextRequest) {
  let body: { armed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.armed !== "boolean") {
    return NextResponse.json({ error: "armed (boolean) required" }, { status: 400 });
  }
  const ok = await setBotArmed(body.armed);
  if (!ok) return NextResponse.json({ error: "supabase not configured or update failed" }, { status: 503 });
  return NextResponse.json({ ok: true, armed: body.armed });
}
