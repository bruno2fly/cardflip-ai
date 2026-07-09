import { NextResponse } from "next/server";
import { getHuntList } from "@/lib/hunt";

export const dynamic = "force-dynamic";

/**
 * GET /api/hunt
 * Returns the auto-generated hunt list (top flip-worthy cards by TCGPlayer
 * holofoil market price, $30–$3000), cached in memory for 6 hours.
 * Response: { cards: HuntCard[], updatedAt: epoch-ms }
 */
export async function GET() {
  try {
    const list = await getHuntList();
    return NextResponse.json(list);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Hunt list failed: ${message}` }, { status: 502 });
  }
}
