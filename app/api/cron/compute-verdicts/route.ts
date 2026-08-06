import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { getBestBuyStock, getTargetStock } from "@/lib/stock";
import { getSealedPrices } from "@/lib/sealedPricing";
import { getConfirmedReleases } from "@/lib/releases";
import { getPriceTrends, PriceTrend } from "@/lib/priceTrend";
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
export async function GET(req: Request) {
  // ?force=true — ignore the 24h freshness window and work through ALL
  // targets (never-computed first, then stalest), so repeated manual runs
  // make real progress toward full coverage instead of waiting days.
  const force = new URL(req.url).searchParams.get("force") === "true"
    || new URL(req.url).searchParams.get("all") === "true";
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
    // FAIL LOUD if this query errors: silently treating "couldn't read
    // existing verdicts" as "no fresh verdicts" is what let the cron burn
    // API budget recomputing the same batch (see lib/supabase.ts note on
    // the Next fetch-cache root cause).
    const { data: existingVerdicts, error: freshnessError } = await supabase
      .from("product_verdicts")
      .select("product_id, computed_at");
    if (freshnessError) {
      return NextResponse.json(
        { error: `Could not read existing verdicts (refusing to guess): ${freshnessError.message}` },
        { status: 502 }
      );
    }
    const computedAtById = new Map(
      (existingVerdicts ?? []).map(v => [v.product_id, new Date(v.computed_at).getTime()])
    );
    const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const freshIds = new Set(
      Array.from(computedAtById.entries())
        .filter(([, t]) => t > staleCutoff)
        .map(([id]) => id)
    );

    // Progressive ordering either way: never-computed first, then stalest.
    // Repeated runs always advance coverage instead of retreading the
    // front of the array.
    const candidates = force ? [...targets] : targets.filter(t => !freshIds.has(t.productId));
    candidates.sort((a, b) =>
      (computedAtById.get(a.productId) ?? 0) - (computedAtById.get(b.productId) ?? 0)
    );
    const due = candidates.slice(0, MAX_VERDICTS_PER_RUN);

    if (due.length === 0) {
      return NextResponse.json({ configured: true, checked: targets.length, dueForRecompute: 0, computed: 0 });
    }

    // --- gather real signals shared across all targets in this run ---
    const [bestbuy, target, sealedPrices, releases, trends] = await Promise.all([
      getBestBuyStock(due.map(t => ({ id: t.productId, name: t.productName }))),
      getTargetStock(due.map(t => ({ id: t.productId, name: t.productName }))),
      getSealedPrices(due.map(t => ({ id: t.productId, name: t.productName, tcgProductId: t.tcgProductId }))),
      getConfirmedReleases().catch(() => ({ upcoming: [], recent: [] })),
      getPriceTrends(due.map(t => t.productId)).catch((): Record<string, PriceTrend> => ({})),
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
      const trend = trends[t.productId];

      const inputs: VerdictInputs = {
        productName: t.productName,
        msrp: t.msrp,
        marketPrice: price?.market ?? null,
        marketPriceSource: price?.source ?? null,
        priceTrendDirection: trend?.sufficient ? trend.direction : null,
        priceTrendPercent: trend?.sufficient ? trend.percentChange : null,
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
          citations: call.citations,
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
      force,
      checked: targets.length,
      dueForRecompute: due.length,
      dueIds: due.map(t => t.productId),
      computed,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Verdict computation failed: ${message}` }, { status: 502 });
  }
}
