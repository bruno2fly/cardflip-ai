import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { addCuratedProductToWatchlist, addToWatchlist, getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getWatchlist());
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: unknown; productId?: unknown };
    const product = typeof body.productId === "string"
      ? PRODUCTS.find(candidate => candidate.id === body.productId)
      : undefined;
    if (typeof body.productId === "string" && !product) {
      return NextResponse.json({ ok: false, reason: "Curated product not found." }, { status: 404 });
    }
    const result = product
      ? await addCuratedProductToWatchlist(product)
      : await addToWatchlist(typeof body.query === "string" ? body.query : "");
    return NextResponse.json(result, { status: result.ok ? 201 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid watchlist request." }, { status: 400 });
  }
}
