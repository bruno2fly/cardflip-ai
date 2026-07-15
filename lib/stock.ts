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

// ------------------------------------------------------------------
// Target (RedSky — unofficial, fragile by design; see header comment)
// ------------------------------------------------------------------

// Public web key from target.com's own frontend bundle — not a secret.
const REDSKY_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const REDSKY_SEARCH = "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2";
const REDSKY_STORE = "3991"; // any valid store id works for shipping availability
const REDSKY_TIMEOUT_MS = 6000;

let targetCache: StockResult | null = null;

/** Walk the fulfillment blob defensively — RedSky's shape shifts over time. */
function extractAvailability(product: unknown): StockState {
  try {
    const fulfillment = (product as { fulfillment?: Record<string, unknown> })?.fulfillment;
    if (!fulfillment) return "unknown";
    const shipping = fulfillment.shipping_options as { availability_status?: string } | undefined;
    const status = shipping?.availability_status ?? (fulfillment.availability_status as string | undefined);
    if (status === "IN_STOCK" || status === "PRE_ORDER_SELLABLE") return "in-stock";
    if (status === "OUT_OF_STOCK" || status === "DISCONTINUED" ||
        fulfillment.is_out_of_stock_in_all_store_locations === true) return "out-of-stock";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function checkOneTarget(productId: string, name: string): Promise<ProductStock> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDSKY_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      key: REDSKY_KEY,
      keyword: name,
      count: "4",
      offset: "0",
      page: `/s/${encodeURIComponent(name)}`,
      channel: "WEB",
      store_id: REDSKY_STORE,
      pricing_store_id: REDSKY_STORE,
      visitor_id: "0100000000000000000000000000000000",
    });
    const res = await fetch(`${REDSKY_SEARCH}?${params}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json",
        "Origin": "https://www.target.com",
        "Referer": "https://www.target.com/",
      },
    });
    // 403 = Akamai bot wall (expected from datacenter IPs) → unknown, not an error
    if (!res.ok) return { productId, status: "unknown", sku: null, url: null };
    const json = await res.json();
    const products: unknown[] = json?.data?.search?.products ?? [];
    const first = products[0] as {
      tcin?: string;
      item?: { enrichment?: { buy_url?: string } };
    } | undefined;
    if (!first?.tcin) return { productId, status: "unknown", sku: null, url: null };

    return {
      productId,
      status: extractAvailability(first),
      sku: String(first.tcin),
      url: first.item?.enrichment?.buy_url ?? null,
    };
  } catch {
    return { productId, status: "unknown", sku: null, url: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Target stock via RedSky, matched by keyword search (no per-product TCINs
 * pinned yet). Never throws; blocked/failed calls come back "unknown".
 * Cached in memory for 15 minutes.
 */
export async function getTargetStock(
  products: { id: string; name: string }[],
  force = false
): Promise<StockResult> {
  if (!force && targetCache && Date.now() - targetCache.checkedAt < CACHE_TTL_MS) return targetCache;

  const statuses: ProductStock[] = [];
  for (const p of products) {
    statuses.push(await checkOneTarget(p.id, p.name));
    await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
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
