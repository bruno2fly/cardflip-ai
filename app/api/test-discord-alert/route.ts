import { NextResponse } from "next/server";
import { sendStockAlerts, StockFlip } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY — one-time manual test of the alert pipeline (Discord/email/SMS)
 * ahead of the Sep 10 ~3AM Target drop window. Fires a synthetic StockFlip
 * through the REAL sendStockAlerts() function — same code path the stock
 * cron uses — so this proves the fan-out actually works end-to-end, not
 * just that the webhook URL exists. DELETE THIS FILE after the test.
 */
export async function GET() {
  const testFlip: StockFlip = {
    productId: "test-alert-manual-check",
    retailer: "target",
    name: "🧪 TEST — Pokemon TCG Mega Evolution Chaos Rising ETB (this is a drill)",
    msrp: 179.99,
    status: "in-stock",
    sku: "1011710073",
    url: "https://www.target.com/p/pokemon-tcg-mega-evolution-chaos-rising-pokemon-center-elite-trainer-box/-/A-1011710073",
    price: 179.99,
  };

  const result = await sendStockAlerts([testFlip]);
  return NextResponse.json({ test: true, result });
}
