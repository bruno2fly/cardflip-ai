import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=<free text>&pageSize=12
 *
 * Card search backed by TCGPlayer's own marketplace search API — the same
 * endpoint tcgplayer.com uses. Chosen over api.pokemontcg.io because:
 *   - it has the NEWEST sets immediately (pokemontcg.io lags months behind, so
 *     brand-new cards like "Mega Scrafty ex - 270/217 - ME: Ascended Heroes"
 *     simply aren't there yet),
 *   - its fuzzy search matches by name OR card number OR a full pasted
 *     "Name - 270/217 - Set (CODE)" string,
 *   - every hit already carries the market price, so the caller can prefill a
 *     value without a second lookup.
 *
 * Verified reachable from datacenter IPs (unlike tcgplayer.com product pages,
 * which are Cloudflare-walled). Returns { data: SearchResult[] } — the same
 * shape the inventory/grading pages already consume, plus a `market` field.
 */

const TCG_SEARCH = "https://mp-search-api.tcgplayer.com/v1/search/request";

/** Real card photo from TCGPlayer's public image CDN. */
function tcgImg(productId: number): string {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_400x400.jpg`;
}

/** TCGPlayer appends the number to productName ("Charizard ex - 199/165"). Strip it for a clean name. */
function cleanName(productName: string): string {
  const stripped = productName.replace(/\s*-\s*[A-Za-z0-9]+\/[A-Za-z0-9]+\s*$/, "").trim();
  return stripped || productName.trim();
}

type TcgResult = {
  productId?: number;
  productName?: string;
  setName?: string;
  rarityName?: string;
  marketPrice?: number | null;
  sealed?: boolean;
  customAttributes?: { number?: string | null };
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing required query param: q" }, { status: 400 });
  }
  const pageSize = Math.min(24, Math.max(1, parseInt(searchParams.get("pageSize") ?? "12", 10) || 12));

  const body = {
    algorithm: "sales_synonym_v2",
    from: 0,
    size: pageSize,
    // Pokemon single cards only (sealed products filtered out below).
    filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
    context: { cart: {}, shippingCountry: "US" },
    settings: { useFuzzySearch: true, didYouMean: {} },
    sort: {},
  };

  try {
    const res = await fetch(`${TCG_SEARCH}?q=${encodeURIComponent(q)}&isList=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // TCGPlayer's search API expects browser-like headers; a bare fetch is refused.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Origin: "https://www.tcgplayer.com",
        Referer: "https://www.tcgplayer.com/",
      },
      body: JSON.stringify(body),
      // cache identical searches briefly to be gentle on the upstream
      next: { revalidate: 120 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `TCGPlayer search responded ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const results: TcgResult[] = json?.results?.[0]?.results ?? [];

    const data = results
      .filter(r => r && r.productId != null && !r.sealed)
      .map(r => {
        const productId = Number(r.productId);
        return {
          id: String(productId),
          name: cleanName(String(r.productName ?? "")),
          set: { name: r.setName ?? "" },   // TCGPlayer number is already "270/217", so no printedTotal
          number: r.customAttributes?.number ?? "",
          rarity: r.rarityName ?? undefined,
          images: { small: tcgImg(productId), large: tcgImg(productId) },
          market: typeof r.marketPrice === "number" ? r.marketPrice : null,
          tcgProductId: productId,
        };
      });

    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Search failed: ${message}` }, { status: 502 });
  }
}
