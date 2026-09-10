/**
 * Live stock checks.
 *
 * Best Buy — official public Products API (developer.bestbuy.com, free key).
 *
 * Target — UNOFFICIAL RedSky endpoint (the JSON API target.com itself calls).
 * No key needed beyond the public web key baked into Target's own site, but
 * it sits behind Akamai bot protection: datacenter IPs (including Vercel's)
 * typically get 403/CAPTCHA. Every call is wrapped so ANY failure degrades to
 * "unknown" — a Target hiccup can never break the page or the cron.
 *
 * Walmart and Pokemon Center offer no usable API — manual-check links only,
 * we never fake a status we can't verify.
 */

export type StockState = "in-stock" | "out-of-stock" | "unknown";

export type ProductStock = {
  productId: string;
  status: StockState;
  sku: string | null;
  url: string | null;   // direct Best Buy product page when matched
  price: number | null; // verified live sale price (Best Buy only, for now) — null = unverified
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
  salePrice?: number;
};

async function checkOne(apiKey: string, productId: string, name: string): Promise<ProductStock> {
  try {
    // Best Buy search syntax: products(search=word&search=word2...) — terms are ANDed
    const terms = name
      .split(/\s+/)
      .filter(Boolean)
      .map(w => `search=${encodeURIComponent(w.toLowerCase())}`)
      .join("&");
    const url = `${BB_API}(${terms})?apiKey=${apiKey}&format=json&show=sku,name,onlineAvailability,url,salePrice&pageSize=3`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { productId, status: "unknown", sku: null, url: null, price: null };
    const json = await res.json();
    const match: BBProduct | undefined = (json.products ?? [])[0];

    if (!match) return { productId, status: "unknown", sku: null, url: null, price: null };
    return {
      productId,
      status: match.onlineAvailability ? "in-stock" : "out-of-stock",
      sku: String(match.sku),
      url: match.url ?? null,
      // only trust the price when it's actually purchasable online — an
      // out-of-stock listing's "salePrice" is not a real buyable price
      price: match.onlineAvailability && typeof match.salePrice === "number" ? match.salePrice : null,
    };
  } catch {
    return { productId, status: "unknown", sku: null, url: null, price: null };
  }
}

// ------------------------------------------------------------------
// Target — direct product-page monitoring (see lib/targetStock.ts).
// The old RedSky API/search approach is dead (Akamai-walled from cloud IPs);
// getTargetStock below now delegates to the direct-page checker.
// ------------------------------------------------------------------

let targetCache: StockResult | null = null;

/**
 * Target stock — now via the DIRECT product page (lib/targetStock.ts), which
 * is server-rendered and reachable from cloud IPs, unlike the RedSky API/
 * search views which the Akamai wall blocks (checkOneTarget above is kept for
 * reference but no longer used). Only products with a pinned `targetTcin`
 * are monitored; the rest return "unknown". Never throws; wall hits degrade
 * to "unknown". Cached in memory for 15 minutes.
 */
export async function getTargetStock(
  products: { id: string; name: string; tcin?: number }[],
  force = false,
  batch?: import("@/lib/targetStock").TargetBatchOptions
): Promise<StockResult> {
  if (!force && targetCache && Date.now() - targetCache.checkedAt < CACHE_TTL_MS) return targetCache;

  const { getTargetStockDirect } = await import("@/lib/targetStock");
  const { statuses, monitored, blocked } = await getTargetStockDirect(
    products.map(p => ({ id: p.id, tcin: p.tcin })),
    batch
  );
  if (monitored > 0 && blocked === monitored) {
    console.warn(`[stock] Target: all ${monitored} monitored products hit the bot-wall this run — all degraded to unknown`);
  }

  targetCache = { configured: true, checkedAt: Date.now(), statuses };
  return targetCache;
}

// ------------------------------------------------------------------
// Best Buy (official API)
// ------------------------------------------------------------------

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
      statuses: products.map(p => ({ productId: p.id, status: "unknown" as const, sku: null, url: null, price: null })),
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
