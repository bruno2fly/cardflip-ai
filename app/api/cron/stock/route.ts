import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock, getTargetStock, ProductStock } from "@/lib/stock";
import { sendStockAlerts, StockFlip, Retailer } from "@/lib/alerts";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stock — cadence in vercel.json; see STOCK_CHECK_INTERVAL_MINUTES
 * in lib/alerts.ts for the tunable interval + Best Buy quota math.
 * Checks Best Buy (official API) AND Target (direct product page; degrades to
 * "unknown"/"blocked" when the bot-wall blocks). Alerts ONLY on a flip to
 * in-stock, per retailer, across email + SMS + Discord. State transitions
 * live in Supabase `stock_alerts_log` keyed by (retailer, product_id) so a
 * single flip fires each channel exactly once and never re-alerts.
 */
export async function GET() {
  try {
    const list = PRODUCTS.map(p => ({ id: p.id, name: p.name }));
    const [bestbuy, target] = await Promise.all([
      getBestBuyStock(list, true),
      getTargetStock(list, true),
    ]);

    const checks: (ProductStock & { retailer: Retailer })[] = [
      ...(bestbuy.configured ? bestbuy.statuses.map(s => ({ ...s, retailer: "bestbuy" as const })) : []),
      ...target.statuses.map(s => ({ ...s, retailer: "target" as const })),
    ];

    if (checks.length === 0) {
      return NextResponse.json({ skipped: "No retailer checks ran (BESTBUY_API_KEY not set, Target returned nothing)" });
    }
    if (!supabase) {
      return NextResponse.json({
        skipped: "Supabase not configured — stock_alerts_log needed for flip detection",
      });
    }

    // last recorded status per (retailer, product). FAIL LOUD on read error:
    // silently treating "couldn't read log" as "no prior status" would
    // re-alert every product on every run.
    const { data: logRows, error: logError } = await supabase
      .from("stock_alerts_log")
      .select("product_id, retailer, status, created_at")
      .order("created_at", { ascending: false });
    if (logError) {
      return NextResponse.json(
        { error: `Could not read stock_alerts_log (refusing to guess): ${logError.message}` },
        { status: 502 }
      );
    }
    const lastStatus = new Map<string, string>();
    for (const row of logRows ?? []) {
      const key = `${row.retailer ?? "bestbuy"}:${row.product_id}`;
      if (!lastStatus.has(key)) lastStatus.set(key, row.status);
    }

    const byId = new Map(PRODUCTS.map(p => [p.id, p]));
    const flips: StockFlip[] = [];
    const changes: { product_id: string; product_name: string; status: string; sku: string | null; retailer: Retailer }[] = [];

    for (const s of checks) {
      const prev = lastStatus.get(`${s.retailer}:${s.productId}`);
      if (prev === s.status) continue; // no change, nothing to log or alert

      const product = byId.get(s.productId)!;
      changes.push({ product_id: s.productId, product_name: product.name, status: s.status, sku: s.sku, retailer: s.retailer });

      // alert only on a flip TO in-stock from out-of-stock/unknown/blocked/never-seen
      if (s.status === "in-stock" && prev !== "in-stock") {
        flips.push({ ...s, retailer: s.retailer, name: product.name, msrp: product.msrp });
      }
    }

    // fan out to every configured channel (email + SMS + Discord), once per flip
    const alerts = flips.length > 0
      ? await sendStockAlerts(flips)
      : { email: false, sms: false, discord: false };

    // record every status change (marks the new state so we don't re-alert)
    if (changes.length > 0) {
      await supabase.from("stock_alerts_log").insert(changes);
    }

    return NextResponse.json({
      bestbuyConfigured: bestbuy.configured,
      checked: checks.length,
      statusChanges: changes.length,
      flipsToInStock: flips.length,
      alerts,
      channelsConfigured: {
        email: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
        sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.TARGET_ALERT_PHONE),
        discord: Boolean(process.env.DISCORD_ALERT_WEBHOOK_URL),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Stock scan failed: ${message}` }, { status: 502 });
  }
}
