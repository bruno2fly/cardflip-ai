import { NextResponse } from "next/server";
import { sendStockAlerts, StockFlip } from "@/lib/alerts";

// TEMP: one-time end-to-end alert-pipeline test ahead of the Sep 16 30th
// Anniversary drop. Fires a SIMULATED flip through all 3 channels (email/
// SMS/Discord) using a real tracked product, bypassing Supabase dedup on
// purpose (this is not a real stock change). Remove after verifying.
export const dynamic = "force-dynamic";

export async function GET() {
  const flip: StockFlip = {
    productId: "test-30th-etb",
    status: "in-stock",
    sku: null,
    url: "https://www.target.com/p/pok-233-mon-trading-card-game-30th-celebration-elite-trainer-box/-/A-1010892076",
    price: 69.99,
    retailer: "target",
    name: "[TEST] Pokémon TCG: 30th Celebration Elite Trainer Box",
    msrp: 69.99,
  };
  const result = await sendStockAlerts([flip]);
  return NextResponse.json({ test: true, sentFlip: flip, result });
}
