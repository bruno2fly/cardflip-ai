import { NextResponse } from "next/server";
import { getPriceTrends } from "@/lib/priceTrend";

export const dynamic = "force-dynamic";

/**
 * GET /api/price-trend
 * Real 14-day price-momentum trend per product, computed from the
 * price_history log. Returns { trends: PriceTrend[] } for every product with
 * recent history (curated, discovered, or inventory ids alike). Fully
 * fail-soft: no Supabase or an empty table just yields an empty list, and the
 * UI falls back to each product's manual hotness / "tracking" state.
 */
export async function GET() {
  try {
    const map = await getPriceTrends(); // all products with recent history
    return NextResponse.json({ trends: Object.values(map) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Price trend failed: ${message}`, trends: [] }, { status: 502 });
  }
}
