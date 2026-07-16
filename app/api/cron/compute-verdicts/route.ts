import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { getBestBuyStock, getTargetStock } from "@/lib/stock";
import { getSealedPrices } from "@/lib/sealedPricing";
import { getConfirmedReleases } from "@/lib/releases";
import { computeVerdict, VerdictInputs } from "@/lib/verdicts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same cost-conscious cap discover-products uses — gentle on the LLM budget.
const MAX_VERDICTS_PER_RUN = 12;

type Target = {
  productId: string;
  productName: string;
  msrp: number | null;
  tcgProductId?: number;
};

/**
 * GET /api/cron/compute-verdicts — once daily (see vercel.json), after discovery.
 * Computes a BUY/WAIT/AVOID verdict for curated PRODUCTS + verified
 * discovered_products, using only real, live signals (market price, retailer
 * stock, release timing, discovery source). Entirely inert without
 * PERPLEXITY_API_KEY — reports { configured: false } and does nothing.
 */
export async function GET() {
  // cheap local check — no need to spend an API call just to test configuration
  if (!process.env.PERPLEXITY_API_KEY) {
    return NextResponse.json({
      configured: false,
      skipped: "PERPLEXITY_API_KEY not set — decision engine is inert until it's added",
    });
  }

  if (!supabase) {
    return NextResponse.json({
      configured: true,
      skipped: "Supabase not configured — product_verdicts table needed to persist verdicts",
    });
  }

  try {
    // --- gather targets: curated PRODUCTS + verified discovered_products ---
    const targets: Target[] = PRODUCTS.map(p => ({
      productId: p.id, productName: p.name, msrp: p.msrp, tcgProductId: p.tcgProductId,
    }));

    const { data: discoveredRows } = await supabase
      .from("discovered_products")
      .select("tcg_product_id, verified_name, candidate_name, msrp, source, source_signal")
      .eq("status", "verified");
    for (const r of discoveredRows ?? []) {
      if (!r.tcg_product_id) continue;
      targets.push({
        productId: `disc-${r.tcg_product_id}`,
        productName: r.verified_name ?? r.candidate_name,
        msrp: r.msrp != null ? Number(r.msrp) : null,
        tcgProductId: Number(r.tcg_product_id),
      });
    }

    // --- staleness: only recompute verdicts older than 24h (or missing) ---
    const { data: existingVerdicts } = await supabase
      .from("product_verdicts")
      .select("product_id, computed_at");
    const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const freshIds = new Set(
      (existingVerdicts ?? [])
        .filter(v => new Date(v.computed_at).getTime() > staleCutoff)
        .map(v => v.product_id)
    );
    const due = targets.filter(t => !freshIds.has(t.productId)).slice(0, MAX_VERDICTS_PER_RUN);

    if (due.length === 0) {
      return NextResponse.json({ configured: true, checked: targets.length, dueForRecompute: 0, computed: 0 });
    }

    // --- gather real signals shared across all targets in this run ---
    const [bestbuy, target, sealedPrices, releases] = await Promise.all([
      getBestBuyStock(due.map(t => ({ id: t.productId, name: t.productName }))),
      getTargetStock(due.map(t => ({ id: t.productId, name: t.productName }))),
      getSealedPrices(due.map(t => ({ id: t.productId, name: t.productName, tcgProductId: t.tcgProductId }))),
      getConfirmedReleases().catch(() => ({ upcoming: [], recent: [] })),
    ]);
    const bbById = new Map(bestbuy.statuses.map(s => [s.productId, s]));
    const tgById = new Map(target.statuses.map(s => [s.productId, s]));
    const priceById = new Map(sealedPrices.prices.map(p => [p.productId, p]));
    const releaseByName = new Map(
      [...releases.upcoming, ...releases.recent].map(r => [r.name.toLowerCase(), r])
    );

    let computed = 0, failed = 0;
    const errors: string[] = [];

    for (const t of due) {
      const bb = bbById.get(t.productId);
      const tg = tgById.get(t.productId);
      const price = priceById.get(t.productId);
      const release = releaseByName.get(t.productName.toLowerCase());

      const inputs: VerdictInputs = {
        productName: t.productName,
        msrp: t.msrp,
        marketPrice: price?.market ?? null,
        marketPriceSource: price?.source ?? null,
        bestBuyStatus: bb?.status ?? "unknown",
        bestBuyPrice: bb?.price ?? null,
        targetStatus: tg?.status ?? "unknown",
        daysUntilRelease: release?.daysUntil ?? null,
        daysSinceRelease: release?.daysAgo ?? null,
        announcedVia: release?.announcedVia ?? null,
        discoverySource: t.productId.startsWith("disc-") ? "auto-discovery" : null,
        discoverySignal: null,
        ownedCostBasis: null,
        ownedQty: null,
      };

      const call = await computeVerdict(inputs);
      if (call.configured && call.result) {
        const { error } = await supabase.from("product_verdicts").upsert({
          product_id: t.productId,
          product_name: t.productName,
          verdict: call.result.verdict,
          confidence: call.result.confidence,
          reason: call.result.reason,
          computed_at: new Date().toISOString(),
          inputs_snapshot: inputs,
        });
        if (error) { failed++; errors.push(error.message); } else { computed++; }
      } else {
        failed++;
        if (call.configured && call.error) errors.push(`${t.productId}: ${call.error}`);
      }
      // gentle on Perplexity's rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({
      configured: true,
      checked: targets.length,
      dueForRecompute: due.length,
      computed,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Verdict computation failed: ${message}` }, { status: 502 });
  }
}
