import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock, getTargetStock, ProductStock } from "@/lib/stock";
import { sendStockAlerts, StockFlip, Retailer, STOCK_CHECK_INTERVAL_MINUTES } from "@/lib/alerts";
import { supabase } from "@/lib/supabase";
import { fetchNowInStockListings, matchToProduct } from "@/lib/nowInStock";
import { getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";
// Cron fires at most once/minute on Vercel (Pro min interval; Hobby is daily-
// only) — see vercel.json ("* * * * *"). An earlier version of this file
// tried to squeeze out ~30s effective latency by running the full check
// TWICE per invocation (immediate + after a 30s in-function sleep). That
// pushed real invocations past 60s and Vercel started returning 504s —
// confirmed live via `vercel logs` during tonight's drop window, so it was
// reverted same night. ONE pass per invocation, 1x/minute cadence. Do not
// reintroduce the double-pass/sleep pattern without confirming a single
// pass's real p95 duration in production logs first.
export const maxDuration = 30;

// Cap on how many Target TCINs are fetched per stock-cron run. The Target
// watchlist can now hold up to hundreds of products (via the Target catalog),
// and checking all of them sequentially every 2 minutes would overrun the run
// and hammer Target. getTargetStock round-robins a rotating slice of this size
// per run (see selectRoundRobinBatch in lib/targetStock.ts); every product is
// still covered within ceil(N/cap) runs. Tune with TARGET_MAX_CHECKS_PER_RUN.
const TARGET_MAX_CHECKS_PER_RUN = Number(process.env.TARGET_MAX_CHECKS_PER_RUN) || 40;

type PassResult = Record<string, unknown>;

/**
 * One full stock-check pass: Best Buy + Target + nowInStock, flip detection
 * against Supabase, alert fan-out.
 */
async function runOnce(): Promise<PassResult> {
  try {
    const watchlist = await getWatchlist();
    const catalogList = PRODUCTS.map(p => ({ id: p.id, name: p.name, tcin: p.targetTcin }));
    const watchlistList = watchlist.map(p => ({ id: p.id, name: p.productName, tcin: p.targetTcin ?? undefined }));
    const list = [...catalogList, ...watchlistList];
    const [bestbuy, target, nowInStock] = await Promise.all([
      getBestBuyStock(list, true),
      // Round-robin the Target checks so a large monitored set stays polite.
      getTargetStock(list, true, {
        maxPerRun: TARGET_MAX_CHECKS_PER_RUN,
        intervalMs: STOCK_CHECK_INTERVAL_MINUTES * 60_000,
      }),
      fetchNowInStockListings(true),
    ]);

    const rawChecks: (ProductStock & { retailer: Retailer; source: "direct" | "nowinstock" })[] = [
      ...(bestbuy.configured ? bestbuy.statuses.map(s => ({ ...s, retailer: "bestbuy", source: "direct" as const })) : []),
      ...target.statuses.map(s => ({ ...s, retailer: "target", source: "direct" as const })),
      ...nowInStock.flatMap(listing => {
        // Match each collection independently. If a user intentionally adds a
        // curated product to the watchlist, its UUID still gets an independent
        // dedup state rather than losing to the catalog id on a tie.
        const ids = [
          matchToProduct(listing.rawName, catalogList),
          watchlistList.length > 0 ? matchToProduct(listing.rawName, watchlistList) : null,
        ].filter((id): id is string => id != null);
        return ids.map(productId => ({
          productId,
          status: listing.status === "preorder" ? "in-stock" as const : listing.status,
          sku: null,
          url: listing.buyUrl,
          price: listing.price,
          retailer: listing.retailer,
          source: "nowinstock" as const,
        }));
      }),
    ];
    // A feed can contain more than one URL for the same product/retailer.
    // Collapse those to one state, with a buyable listing taking precedence.
    const checksByKey = new Map<string, typeof rawChecks[number]>();
    const rank: Record<ProductStock["status"], number> = { unknown: 0, "out-of-stock": 1, "in-stock": 2 };
    for (const check of rawChecks) {
      const key = `${check.source}:${check.retailer}:${check.productId}`;
      const current = checksByKey.get(key);
      if (!current || rank[check.status] > rank[current.status]) checksByKey.set(key, check);
    }
    const checks = Array.from(checksByKey.values());

    if (checks.length === 0) {
      return { skipped: "No retailer checks ran (BESTBUY_API_KEY not set, Target returned nothing)" };
    }
    if (!supabase) {
      return { skipped: "Supabase not configured — stock_alerts_log needed for flip detection" };
    }

    // last recorded status per (retailer, product). FAIL LOUD on read error:
    // silently treating "couldn't read log" as "no prior status" would
    // re-alert every product on every run.
    const { data: logRows, error: logError } = await supabase
      .from("stock_alerts_log")
      .select("product_id, retailer, source, status, created_at")
      .order("created_at", { ascending: false });
    if (logError) {
      return { error: `Could not read stock_alerts_log (refusing to guess): ${logError.message}` };
    }
    const lastStatus = new Map<string, string>();
    for (const row of logRows ?? []) {
      const key = `${row.source ?? "direct"}:${row.retailer ?? "bestbuy"}:${row.product_id}`;
      if (!lastStatus.has(key)) lastStatus.set(key, row.status);
    }

    const byId = new Map<string, { name: string; msrp: number }>([
      ...PRODUCTS.map(p => [p.id, { name: p.name, msrp: p.msrp }] as const),
      ...watchlist.map(p => [p.id, { name: p.productName, msrp: p.msrp ?? 0 }] as const),
    ]);
    const flips: StockFlip[] = [];
    const changes: { product_id: string; product_name: string; status: string; sku: string | null; retailer: Retailer; source: "direct" | "nowinstock" }[] = [];

    for (const s of checks) {
      const prev = lastStatus.get(`${s.source}:${s.retailer}:${s.productId}`);
      if (prev === s.status) continue; // no change, nothing to log or alert

      const product = byId.get(s.productId);
      if (!product) continue;
      changes.push({ product_id: s.productId, product_name: product.name, status: s.status, sku: s.sku, retailer: s.retailer, source: s.source });

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
      const { error: insertError } = await supabase.from("stock_alerts_log").insert(changes);
      if (insertError) {
        return { error: `Alerts were processed but stock state could not be recorded: ${insertError.message}` };
      }
    }

    return {
      bestbuyConfigured: bestbuy.configured,
      watchlistProducts: watchlist.length,
      nowInStockListings: nowInStock.length,
      checked: checks.length,
      statusChanges: changes.length,
      flipsToInStock: flips.length,
      alerts,
      channelsConfigured: {
        email: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
        sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.TARGET_ALERT_PHONE),
        discord: Boolean(process.env.DISCORD_ALERT_WEBHOOK_URL),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { error: `Stock scan failed: ${message}` };
  }
}

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
  const result = await runOnce();
  const hasError = Boolean((result as { error?: string }).error);
  return NextResponse.json(result, hasError ? { status: 502 } : undefined);
}
