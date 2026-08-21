import { NextResponse } from "next/server";
import { addToWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: unknown };
    const result = await addToWatchlist(typeof body.query === "string" ? body.query : "");
    return NextResponse.json(result, { status: result.ok ? 201 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid watchlist request." }, { status: 400 });
  }
}
