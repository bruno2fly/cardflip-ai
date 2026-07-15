import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock, getTargetStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock
 * Live stock status per retailer for every tracked sealed product (15-min cache).
 * Returns { bestbuy: { configured, checkedAt, statuses }, target: { ... } }.
 * bestbuy.configured=false → BESTBUY_API_KEY missing. Target has no key; its
 * statuses are "unknown" whenever RedSky blocks or shifts (expected on Vercel).
 */
export async function GET() {
  try {
    const list = PRODUCTS.map(p => ({ id: p.id, name: p.name }));
    const [bestbuy, target] = await Promise.all([
      getBestBuyStock(list),
      getTargetStock(list),
    ]);
    return NextResponse.json({ bestbuy, target });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Stock check failed: ${message}` }, { status: 502 });
  }
}
