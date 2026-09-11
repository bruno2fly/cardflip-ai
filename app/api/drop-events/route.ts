import { NextResponse } from "next/server";
import { getActiveDropEvents } from "@/lib/dropEvents";
import { loadTargetCatalog } from "@/lib/targetCatalog";
import { productUrl } from "@/lib/targetStock";
import { getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

/**
 * GET /api/drop-events
 *
 * The "get ready to buy" board for the Drops page. Returns the active (not yet
 * expired) curated drop events, each with its products resolved from the Target
 * catalog (name, MSRP, real direct URL) plus whether each product is already on
 * the watchlist (so the UI shows "Tracking" vs a Track button).
 *
 * Intentionally does NOT hammer Target for live per-product stock here — the
 * live "it's in stock, buy now" signal is delivered by the existing stock cron
 * + alert channels once a product is Tracked. This keeps the page fast and
 * reliable (no risk of a serverless timeout checking many product pages inline).
 */
export async function GET() {
  const events = getActiveDropEvents();
  const catalog = loadTargetCatalog();
  const byTcin = new Map(catalog.map(c => [c.tcin, c]));

  let tracked = new Set<number>();
  try {
    const watchlist = await getWatchlist();
    tracked = new Set(watchlist.map(w => w.targetTcin).filter((t): t is number => t != null));
  } catch {
    /* watchlist optional — an empty tracked set is fine */
  }

  const out = events.map(event => ({
    id: event.id,
    title: event.title,
    retailer: event.retailer,
    dropsAt: event.dropsAt,
    window: event.window ?? null,
    confidence: event.confidence,
    note: event.note,
    sourceUrl: event.sourceUrl ?? null,
    products: event.tcins.map(tcin => {
      const c = byTcin.get(tcin);
      return {
        tcin,
        name: c?.name ?? `Target product ${tcin}`,
        msrp: c?.price ?? null,
        url: c?.url ?? productUrl(tcin),
        tracked: tracked.has(tcin),
      };
    }),
  }));

  return NextResponse.json({ generatedAt: new Date().toISOString(), events: out });
}
