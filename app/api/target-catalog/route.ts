import { NextResponse } from "next/server";
import { loadTargetCatalog } from "@/lib/targetCatalog";
import { PRODUCTS } from "@/lib/products";
import { getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

/**
 * GET /api/target-catalog
 *
 * Serves the normalized Target catalog to the browser (the catalog data layer
 * is server-only — it reads the filesystem — so the client reaches it here).
 * Also returns which TCINs are ALREADY monitored, so the UI can show a
 * "monitored" badge instead of a Track button:
 *   - curatedTcins: pinned on a curated product in lib/products.ts
 *   - trackedTcins: already added to the watchlist
 */
export async function GET() {
  const products = loadTargetCatalog();

  const curatedTcins = PRODUCTS.map(p => p.targetTcin).filter((t): t is number => t != null);

  let trackedTcins: number[] = [];
  try {
    const watchlist = await getWatchlist();
    trackedTcins = watchlist.map(w => w.targetTcin).filter((t): t is number => t != null);
  } catch {
    /* watchlist is optional; an empty tracked set is fine */
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: products.length,
    curatedTcins,
    trackedTcins,
    products,
  });
}
