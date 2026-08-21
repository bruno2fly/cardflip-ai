import { NextResponse } from "next/server";
import { fetchTcgMarketPrice } from "@/lib/discovery";
import { fetchNowInStockListings, matchToProduct } from "@/lib/nowInStock";
import { getTargetStockDirect } from "@/lib/targetStock";
import { getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getWatchlist();
    const catalog = items.map(item => ({ id: item.id, name: item.productName }));
    const [listings, target, prices] = await Promise.all([
      fetchNowInStockListings(),
      getTargetStockDirect(items.map(item => ({ id: item.id, tcin: item.targetTcin ?? undefined }))),
      Promise.all(items.map(async item => ({ id: item.id, market: await fetchTcgMarketPrice(item.tcgProductId) }))),
    ]);

    const nowInStock = listings.flatMap(listing => {
      if (catalog.length === 0) return [];
      const itemId = matchToProduct(listing.rawName, catalog);
      if (!itemId) return [];
      return [{ ...listing, itemId }];
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      prices: Object.fromEntries(prices.map(price => [price.id, price.market])),
      nowInStock,
      target: target.statuses,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Watchlist status failed: ${message}` }, { status: 502 });
  }
}
