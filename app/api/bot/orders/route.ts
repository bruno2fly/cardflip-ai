import { NextRequest, NextResponse } from "next/server";
import { queueBotOrder } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Enqueue a manual buy order — the "Buy now" button on the /bot page.
 * The Mac mini claims queued orders within ~3 seconds and runs the same
 * Chrome checkout flow as its own auto-detections.
 *
 * Note: manual orders are NOT gated on the master arm switch — clicking
 * this button is already an explicit human instruction to buy. The bot's
 * automatic watchlist purchases ARE gated on armed.
 */

export async function POST(req: NextRequest) {
  let body: { tcin?: unknown; productName?: unknown; price?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const tcin = typeof body.tcin === "string" || typeof body.tcin === "number" ? String(body.tcin) : null;
  if (!tcin) return NextResponse.json({ error: "tcin required" }, { status: 400 });

  const order = await queueBotOrder({
    tcin,
    productName: typeof body.productName === "string" ? body.productName : "",
    price: typeof body.price === "number" ? body.price : null,
    source: "manual",
  });
  if (!order) {
    return NextResponse.json({ error: "supabase not configured or insert failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, order });
}
