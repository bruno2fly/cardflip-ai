/**
 * Best Buy live stock checks via their public Products API
 * (developer.bestbuy.com — free key, no scraping).
 *
 * Honesty note: Best Buy is the ONLY retailer here with a public stock API.
 * Walmart, Target, and Pokemon Center offer none, so those are manual-check
 * links in the UI — we never fake a status we can't verify.
 */

export type StockState = "in-stock" | "out-of-stock" | "unknown";

export type ProductStock = {
  productId: string;
  status: StockState;
  sku: string | null;
  url: string | null;   // direct Best Buy product page when matched
};

export type StockResult = {
  configured: boolean;  // false when BESTBUY_API_KEY is missing
  checkedAt: number;
  statuses: ProductStock[];
};

const BB_API = "https://api.bestbuy.com/v1/products";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REQUEST_GAP_MS = 250;          // free tier allows ~5 req/sec — stay well under

let cache: StockResult | null = null;

type BBProduct = {
  sku: number;
  name: string;
  onlineAvailability: boolean;
  url: string;
};

async function checkOne(apiKey: string, productId: string, name: string): Promise<ProductStock> {
  try {
    // Best Buy search syntax: products(search=word&search=word2...) — terms are ANDed
    const terms = name
      .split(/\s+/)
      .filter(Boolean)
      .map(w => `search=${encodeURIComponent(w.toLowerCase())}`)
      .join("&");
    const url = `${BB_API}(${terms})?apiKey=${apiKey}&format=json&show=sku,name,onlineAvailability,url&pageSize=3`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { productId, status: "unknown", sku: null, url: null };
    const json = await res.json();
    const match: BBProduct | undefined = (json.products ?? [])[0];

    if (!match) return { productId, status: "unknown", sku: null, url: null };
    return {
      productId,
      status: match.onlineAvailability ? "in-stock" : "out-of-stock",
      sku: String(match.sku),
      url: match.url ?? null,
    };
  } catch {
    return { productId, status: "unknown", sku: null, url: null };
  }
}

/**
 * Stock status for a list of products, matched by name search.
 * Never throws: missing key → { configured: false } with every status "unknown".
 * Results are cached in memory for 15 minutes.
 */
export async function getBestBuyStock(
  products: { id: string; name: string }[],
  force = false
): Promise<StockResult> {
  const apiKey = process.env.BESTBUY_API_KEY;

  if (!apiKey) {
    return {
      configured: false,
      checkedAt: Date.now(),
      statuses: products.map(p => ({ productId: p.id, status: "unknown" as const, sku: null, url: null })),
    };
  }

  if (!force && cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache;

  const statuses: ProductStock[] = [];
  for (const p of products) {
    statuses.push(await checkOne(apiKey, p.id, p.name));
    await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
  }

  cache = { configured: true, checkedAt: Date.now(), statuses };
  return cache;
}
