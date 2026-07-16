import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { getBestBuyStock, getTargetStock } from "@/lib/stock";
import { getSealedPrices } from "@/lib/sealedPricing";
import { getConfirmedReleases } from "@/lib/releases";
import { computeVerdict, VerdictInputs } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

/**
 * POST /api/verdicts/inventory { itemId: sealed_inventory.id }
 * On-demand hold/sell verdict for ONE owned inventory lot, using its real
 * cost basis (bought_price, qty) + live market price + the same real
 * signal set the daily product cron uses. Stored under product_id
 * "inv-<sealed_inventory.id>" in product_verdicts so it's distinguishable
 * from curated/discovered product verdicts but reads through the same
 * table/UI pattern.
 *
 * Entirely inert without PERPLEXITY_API_KEY (configured:false, no-op).
 * On-demand (not cron) because cost basis is per-lot, not per-product —
 * computing it for every owned lot on a schedule would spend API budget on
 * lots Jason isn't actively deciding about right now.
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
  const { itemId } = body as { itemId?: unknown };
  if (typeof itemId !== "string" || !itemId.trim()) {
    return NextResponse.json({ error: "Expected itemId string" }, { status: 400 });
  }

  const { data: item, error: itemError } = await supabase
    .from("sealed_inventory")
    .select("*")
    .eq("id", itemId)
    .single();
  if (itemError || !item) {
    return NextResponse.json({ error: "Inventory item not found" }, { status: 404 });
  }

  const product = PRODUCTS.find(p => p.id === item.product_id);
  const productName: string = item.product_name;
  const msrp: number | null = product?.msrp ?? null;
  const tcgProductId = product?.tcgProductId;

  try {
    const [bestbuy, target, sealedPrices, releases] = await Promise.all([
      getBestBuyStock([{ id: item.product_id, name: productName }]),
      getTargetStock([{ id: item.product_id, name: productName }]),
      getSealedPrices([{ id: item.product_id, name: productName, tcgProductId }]),
      getConfirmedReleases().catch(() => ({ upcoming: [], recent: [] })),
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
    });
    if (upsertError) {
      return NextResponse.json({ configured: true, error: upsertError.message }, { status: 502 });
    }

    return NextResponse.json({ configured: true, productId, result: call.result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Verdict computation failed: ${message}` }, { status: 502 });
  }
}
