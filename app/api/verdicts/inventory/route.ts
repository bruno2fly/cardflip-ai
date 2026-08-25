import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { getBestBuyStock, getTargetStock } from "@/lib/stock";
import { getSealedPrices } from "@/lib/sealedPricing";
import { getConfirmedReleases } from "@/lib/releases";
import { getPriceTrend } from "@/lib/priceTrend";
import { computeVerdict, VerdictInputs } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

/**
 * POST /api/verdicts/inventory
 *   { itemId, productId, productName, boughtPrice, qty, currentMarket? }
 *
 * On-demand hold/sell verdict for ONE owned inventory lot, using its real cost
 * basis (boughtPrice, qty) + live market price + the same real signal set the
 * daily product cron uses. Stored under product_id "inv-<itemId>" in
 * product_verdicts (a SHARED table) so it reads through the same UI pattern.
 *
 * The lot fields are sent in the request body rather than re-read from the DB:
 * sealed_inventory is now per-user (RLS-scoped to auth.uid()), and this route
 * runs with the shared anon client which can't see another user's rows. The
 * client already has the item, so it passes it in — no per-user read needed.
 *
 * Entirely inert without PERPLEXITY_API_KEY (configured:false, no-op).
 */
export async function POST(req: Request) {
  if (!process.env.PERPLEXITY_API_KEY) {
    return NextResponse.json({ configured: false, skipped: "PERPLEXITY_API_KEY not set" });
  }
  if (!supabase) {
    return NextResponse.json({ configured: true, error: "Supabase not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as {
    itemId?: unknown; productId?: unknown; productName?: unknown;
    boughtPrice?: unknown; qty?: unknown; currentMarket?: unknown;
  };
  if (typeof b.itemId !== "string" || !b.itemId.trim()) {
    return NextResponse.json({ error: "Expected itemId string" }, { status: 400 });
  }
  if (typeof b.productId !== "string" || typeof b.productName !== "string" || typeof b.boughtPrice !== "number") {
    return NextResponse.json({ error: "Expected productId, productName, boughtPrice" }, { status: 400 });
  }
  const item = {
    id: b.itemId,
    product_id: b.productId,
    product_name: b.productName,
    bought_price: b.boughtPrice,
    qty: typeof b.qty === "number" ? b.qty : 1,
    current_market: typeof b.currentMarket === "number" ? b.currentMarket : null,
  };

  const product = PRODUCTS.find(p => p.id === item.product_id);
  const productName: string = item.product_name;
  const msrp: number | null = product?.msrp ?? null;
  const tcgProductId = product?.tcgProductId;

  try {
    const [bestbuy, target, sealedPrices, releases, trend] = await Promise.all([
      getBestBuyStock([{ id: item.product_id, name: productName }]),
      getTargetStock([{ id: item.product_id, name: productName }]),
      getSealedPrices([{ id: item.product_id, name: productName, tcgProductId }]),
      getConfirmedReleases().catch(() => ({ upcoming: [], recent: [] })),
      getPriceTrend(item.product_id).catch(() => null),
    ]);
    const bb = bestbuy.statuses[0];
    const tg = target.statuses[0];
    const price = sealedPrices.prices[0];
    const release = [...releases.upcoming, ...releases.recent]
      .find(r => r.name.toLowerCase() === productName.toLowerCase());

    // real, live market price wins; fall back to the item's stored snapshot
    // (current_market, taken at add-to-inventory time) — never fabricate one
    const marketPrice = price?.market ?? (item.current_market != null ? Number(item.current_market) : null);

    const inputs: VerdictInputs = {
      productName,
      msrp,
      marketPrice,
      marketPriceSource: price?.market != null ? price.source : null,
      priceTrendDirection: trend?.sufficient ? trend.direction : null,
      priceTrendPercent: trend?.sufficient ? trend.percentChange : null,
      bestBuyStatus: bb?.status ?? "unknown",
      bestBuyPrice: bb?.price ?? null,
      targetStatus: tg?.status ?? "unknown",
      daysUntilRelease: release?.daysUntil ?? null,
      daysSinceRelease: release?.daysAgo ?? null,
      announcedVia: release?.announcedVia ?? null,
      discoverySource: null,
      discoverySignal: null,
      ownedCostBasis: Number(item.bought_price),
      ownedQty: item.qty,
    };

    const call = await computeVerdict(inputs);
    if (!call.configured || !call.result) {
      return NextResponse.json({
        configured: true,
        result: null,
        error: call.configured ? call.error ?? "Verdict did not parse" : undefined,
      });
    }

    const productId = `inv-${item.id}`;
    const { error: upsertError } = await supabase.from("product_verdicts").upsert({
      product_id: productId,
      product_name: productName,
      verdict: call.result.verdict,
      confidence: call.result.confidence,
      reason: call.result.reason,
      computed_at: new Date().toISOString(),
      inputs_snapshot: inputs,
      citations: call.citations,
    });
    if (upsertError) {
      return NextResponse.json({ configured: true, error: upsertError.message }, { status: 502 });
    }

    return NextResponse.json({ configured: true, productId, result: { ...call.result, citations: call.citations } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Verdict computation failed: ${message}` }, { status: 502 });
  }
}
