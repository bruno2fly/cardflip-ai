import { NextResponse } from "next/server";
import { fetchNowInStockListings, matchToProduct } from "@/lib/nowInStock";
import { PRODUCTS } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET() {
  const listings = await fetchNowInStockListings();
  const active = listings
    .filter(listing => listing.status === "in-stock" || listing.status === "preorder")
    .map(listing => ({ ...listing, matchedProductId: matchToProduct(listing.rawName, PRODUCTS) }))
    .sort((a, b) => {
      const aTime = a.lastSeenInStock ? Date.parse(a.lastSeenInStock) : 0;
      const bTime = b.lastSeenInStock ? Date.parse(b.lastSeenInStock) : 0;
      return bTime - aTime;
    });

  return NextResponse.json({ generatedAt: new Date().toISOString(), listings: active });
}
