/**
 * Walmart availability via the DIRECT product page (same "ghost-stock"
 * pattern as lib/targetStock.ts).
 *
 * Unlike Target, Walmart's product page is NOT behind a bot-wall for cloud
 * IPs — confirmed live (Sep 15, 2026): a plain server-side fetch from this
 * same class of network returns full HTML (500-600KB) with no CAPTCHA/robot
 * markers, embedding a `"availabilityStatus":"IN_STOCK"|"OUT_OF_STOCK"|
 * "NOT_AVAILABLE"` field straight in the page's inline JSON. So this checks
 * every pinned item directly, every run, no round-robin needed (the confirmed
 * 30th Celebration list is small).
 *
 * This is READ-ONLY fetching of a publicly visible retail page — exactly what
 * a browser does when you open the listing. No cart, checkout, account, or
 * payment logic.
 */

import type { StockState, ProductStock } from "@/lib/stock";

const TIMEOUT_MS = 9000;
const REQUEST_GAP_MS = 400;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export type WalmartPageState = StockState | "blocked";

export function productUrl(itemId: number | string): string {
  return `https://www.walmart.com/ip/x/${itemId}`;
}

const CHALLENGE_MARKERS = ["Robot or human", "px-captcha", "Access Denied", "are you a human"];

/**
 * Parse availability out of a Walmart product-page HTML string. Primary
 * signal: the inline `"availabilityStatus"` field Walmart's own page JSON
 * carries (IN_STOCK / OUT_OF_STOCK / NOT_AVAILABLE / AVAILABLE). A page can
 * embed more than one instance (main offer + related items) — the FIRST
 * occurrence is the product itself, confirmed live against several real
 * pages during setup.
 */
export function parseWalmartHtml(html: string): WalmartPageState {
  if (!html || html.length < 2000) return "blocked";
  if (CHALLENGE_MARKERS.some(m => html.includes(m))) return "blocked";

  const isRealProduct = /"usItemId":"\d+"/.test(html);
  if (!isRealProduct) return "blocked";

  const match = html.match(/"availabilityStatus":"([A-Z_]+)"/);
  if (!match) return "unknown";

  switch (match[1]) {
    case "IN_STOCK":
    case "AVAILABLE":
      return "in-stock";
    case "OUT_OF_STOCK":
    case "NOT_AVAILABLE":
      return "out-of-stock";
    default:
      return "unknown";
  }
}

async function checkOne(productId: string, itemId: number): Promise<ProductStock & { blocked: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = productUrl(itemId);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      const blocked = res.status === 403 || res.status === 429;
      return { productId, status: "unknown", sku: String(itemId), url, price: null, blocked };
    }
    const html = await res.text();
    const state = parseWalmartHtml(html);
    if (state === "blocked") {
      console.warn(`[walmartStock] ${productId} (item ${itemId}): bot-wall/challenge or unparseable — degrading to unknown`);
      return { productId, status: "unknown", sku: String(itemId), url, price: null, blocked: true };
    }
    return { productId, status: state, sku: String(itemId), url, price: null, blocked: false };
  } catch {
    return { productId, status: "unknown", sku: String(itemId), url, price: null, blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

export type WalmartStockResult = {
  configured: true; // no API key needed — always "on"
  checkedAt: number;
  statuses: ProductStock[];
  monitored: number;
  blocked: number;
};

/**
 * Check Walmart availability for the given products via their direct product
 * pages. Only products with a pinned `walmartItemId` are monitored; the rest
 * pass through as "unknown". Sequential with a small gap — gentle, human-
 * paced, same convention as Target checks.
 */
export async function getWalmartStock(
  products: { id: string; walmartItemId?: number }[]
): Promise<WalmartStockResult> {
  const statuses: ProductStock[] = [];
  let blocked = 0;

  const withId = products.filter((p): p is { id: string; walmartItemId: number } => Boolean(p.walmartItemId));
  const withoutId = products.filter(p => !p.walmartItemId);

  for (const p of withoutId) {
    statuses.push({ productId: p.id, status: "unknown", sku: null, url: null, price: null });
  }

  for (const p of withId) {
    const r = await checkOne(p.id, p.walmartItemId);
    if (r.blocked) blocked++;
    statuses.push({ productId: r.productId, status: r.status, sku: r.sku, url: r.url, price: r.price });
    await new Promise(res => setTimeout(res, REQUEST_GAP_MS));
  }

  return { configured: true, checkedAt: Date.now(), statuses, monitored: withId.length, blocked };
}
