import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock
 * Best Buy stock status for every tracked sealed product (15-min cache).
 * Returns { configured, checkedAt, statuses: [{ productId, status, sku, url }] }.
 * configured=false means BESTBUY_API_KEY isn't set — statuses are all "unknown".
 */
export async function GET() {
  try {
    const result = await getBestBuyStock(PRODUCTS.map(p => ({ id: p.id, name: p.name })));
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Stock check failed: ${message}` }, { status: 502 });
  }
}
