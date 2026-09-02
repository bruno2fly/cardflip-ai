import { NextResponse } from "next/server";
import { PRODUCTS, type SealedProduct } from "@/lib/products";
import { addCuratedProductToWatchlist, addToWatchlist, getWatchlist } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getWatchlist());
}

type ProductPayload = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  msrp?: unknown;
  imageUrl?: unknown;
  tcgProductId?: unknown;
  targetTcin?: unknown;
};

// Builds a minimal SealedProduct from the client's payload. Only the fields
// addCuratedProductToWatchlist actually reads (name/type/msrp/imageUrl/
// tcgProductId/targetTcin) need to be real -- the retail-link fields are
// never touched by the watchlist insert path, so empty strings are fine.
function productFromPayload(body: ProductPayload): SealedProduct | null {
  if (typeof body.name !== "string" || !body.name.trim()) return null;
  return {
    id: typeof body.id === "string" ? body.id : body.name,
    name: body.name,
    set: "",
    type: (typeof body.type === "string" ? body.type : "ETB") as SealedProduct["type"],
    msrp: typeof body.msrp === "number" ? body.msrp : 49.99,
    tcgplayerUrl: "",
    ebayQuery: "",
    walmartUrl: "",
    targetUrl: "",
    bestbuyUrl: "",
    pokemonCenterUrl: "",
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
    tcgProductId: typeof body.tcgProductId === "number" ? body.tcgProductId : undefined,
    targetTcin: typeof body.targetTcin === "number" ? body.targetTcin : undefined,
    hotness: "✅ Stable",
    notes: "",
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: unknown; productId?: unknown; product?: ProductPayload };

    // Legacy path: curated product looked up by id in the static array.
    // Kept for backward compatibility with any older client bundle still
    // in a user's browser cache.
    const legacyProduct = typeof body.productId === "string"
      ? PRODUCTS.find(candidate => candidate.id === body.productId)
      : undefined;
    if (typeof body.productId === "string" && !legacyProduct) {
      return NextResponse.json({ ok: false, reason: "Curated product not found." }, { status: 404 });
    }

    // Current path: the client sends the full product payload, which works
    // for curated AND auto-discovered products alike (no static-array lookup).
    const payloadProduct = body.product ? productFromPayload(body.product) : undefined;
    if (body.product && !payloadProduct) {
      return NextResponse.json({ ok: false, reason: "Invalid product payload." }, { status: 400 });
    }

    const product = legacyProduct ?? payloadProduct;
    const result = product
      ? await addCuratedProductToWatchlist(product)
      : await addToWatchlist(typeof body.query === "string" ? body.query : "");
    return NextResponse.json(result, { status: result.ok ? 201 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid watchlist request." }, { status: 400 });
  }
}
