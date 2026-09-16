import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock, getTargetStock, getWalmartStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock
 * Live stock status per retailer for every tracked sealed product (15-min cache).
 * Returns { bestbuy: { configured, checkedAt, statuses }, target: { ... },
 * walmart: { ... } }. bestbuy.configured=false → BESTBUY_API_KEY missing.
 * Target/Walmart each check their direct product page for products with a
 * pinned targetTcin/walmartItemId; others (and any bot-wall hits) return
 * "unknown".
 */
export async function GET() {
  try {
    const list = PRODUCTS.map(p => ({ id: p.id, name: p.name, tcin: p.targetTcin, walmartItemId: p.walmartItemId }));
    const [bestbuy, target, walmart] = await Promise.all([
      getBestBuyStock(list),
      getTargetStock(list),
      getWalmartStock(list),
    ]);
    return NextResponse.json({ bestbuy, target, walmart });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Stock check failed: ${message}` }, { status: 502 });
  }
}
