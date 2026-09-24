import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Toggle auto_buy on a watchlist row (identified by its Target TCIN).
 * True = the Mac mini DropBot buys that product when it drops;
 * false = watchlist behaves as before (alerts only).
 */

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  let body: { tcin?: unknown; autoBuy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const tcin = typeof body.tcin === "string" || typeof body.tcin === "number" ? String(body.tcin) : null;
  if (!tcin) return NextResponse.json({ error: "tcin required" }, { status: 400 });
  if (typeof body.autoBuy !== "boolean") {
    return NextResponse.json({ error: "autoBuy (boolean) required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .update({ auto_buy: body.autoBuy })
    .eq("target_tcin", Number(tcin))
    .select("id")
    .maybeSingle();

  if (error) {
    // Most likely cause: the auto_buy migration hasn't been run yet.
    return NextResponse.json(
      { error: `update failed: ${error.message} — did you run supabase/watchlist_add_auto_buy.sql?` },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "no watchlist row with that target_tcin" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, tcin, autoBuy: body.autoBuy });
}
