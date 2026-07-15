import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getSealedPrices } from "@/lib/sealedPricing";

export const dynamic = "force-dynamic";

/**
 * GET /api/sealed-prices
 * Live TCGPlayer market price per sealed product via tcgapi.dev
 * (60-min cache, hard daily budget guard for the 100 req/day free tier).
 * Returns { configured, checkedAt, dailyRemaining, prices: [{ productId, market, matchedName }] }.
 * configured=false → TCGAPI_DEV_KEY not set; market=null → no data, UI
 * falls back to the manual price input.
 */
export async function GET() {
  try {
    const result = await getSealedPrices(
      PRODUCTS.map(p => ({ id: p.id, name: p.name, tcgProductId: p.tcgProductId }))
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Sealed pricing failed: ${message}` }, { status: 502 });
  }
}
