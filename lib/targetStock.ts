/**
 * Target availability via the DIRECT product page (ghost-stock monitoring).
 *
 * Why not RedSky: Target's RedSky JSON API and search/category views are
 * client-rendered through an Akamai-walled endpoint that 403s/CAPTCHAs cloud
 * IPs. But the individual product page at target.com/p/-/A-<TCIN> is
 * server-rendered and, as of testing, loads real HTML from cloud IPs — and
 * critically the Add-to-cart button's `disabled` state is IN that HTML. That
 * per-product page often reflects true availability before the site's search
 * views catch up ("ghost stock").
 *
 * This is READ-ONLY fetching of a publicly visible retail page — exactly what
 * a browser does when you open the listing. No cart, checkout, account, or
 * payment logic. If a request comes back as an Akamai/CAPTCHA challenge
 * instead of real product HTML, we mark it "blocked" and degrade to unknown
 * (same graceful pattern as the old RedSky fallback). We do NOT retry hard or
 * attempt to defeat the wall.
 *
 * Products opt in by pinning a verified `targetTcin` (see lib/products.ts) —
 * same pattern as tcgProductId. Bulk auto-resolution isn't possible because
 * Target's search API is the walled one; TCINs are resolved out-of-band
 * (public web search) and verified against a live product page before pinning.
 */

import type { StockState, ProductStock } from "@/lib/stock";

const TIMEOUT_MS = 9000;
const REQUEST_GAP_MS = 400;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** Internal result adds "blocked" (a wall hit) which maps to "unknown" upstream. */
export type TargetPageState = StockState | "blocked";

export function productUrl(tcin: number | string): string {
  return `https://www.target.com/p/-/A-${tcin}`;
}

const CHALLENGE_MARKERS = ["Pardon Our Interruption", "Access Denied", "Bot Manager", "Request unsuccessful. Incapsula"];

/**
 * Parse availability out of a Target product-page HTML string.
 * Primary signal: the server-rendered Add-to-cart (or Preorder/Ship) button
 * and whether it carries `disabled`. Secondary guard: `buy_url` confirms it's
 * a genuine first-party product page and not a shell/challenge.
 */
export function parseTargetHtml(html: string): TargetPageState {
  if (!html || html.length < 2000) return "blocked";
  if (CHALLENGE_MARKERS.some(m => html.includes(m))) return "blocked";

  const isRealProduct = html.includes("buy_url");

  // The purchase button label is stable even though class names are hashed.
  const btn = html.match(/<button[^>]*>(Add to cart|Add for shipping|Preorder|Pre-order|Ship it)<\/button>/i);
  if (btn) {
    const disabled = /\sdisabled(=|\s|>)/i.test(btn[0]);
    // A live (non-disabled) buy OR preorder button = a real buy opportunity.
    if (!disabled) return "in-stock";
    // Disabled button on a real product page = genuinely out of stock.
    if (isRealProduct) return "out-of-stock";
    return "unknown";
  }

  // Text-marker fallback when the button shape shifts.
  if (/out of stock|sold out|temporarily out of stock/i.test(html)) return "out-of-stock";
  if (isRealProduct && /add to cart|add for shipping/i.test(html)) return "in-stock";

  // Real product page but no signal we trust, or a non-product shell.
  return isRealProduct ? "unknown" : "blocked";
}

async function checkOne(productId: string, tcin: number): Promise<ProductStock & { blocked: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = productUrl(tcin);
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
      // 403/429 = wall; anything non-200 → unknown, never a false "in stock"
      const blocked = res.status === 403 || res.status === 429;
      return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked };
    }
    const html = await res.text();
    const state = parseTargetHtml(html);
    if (state === "blocked") {
      console.warn(`[targetStock] ${productId} (TCIN ${tcin}): bot-wall/challenge or unparseable — degrading to unknown`);
      return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked: true };
    }
    return { productId, status: state, sku: String(tcin), url, price: null, blocked: false };
  } catch {
    // timeout / network → unknown, treated the same as a soft block
    return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

export type TargetStockResult = {
  statuses: ProductStock[];
  monitored: number;   // products that had a pinned TCIN
  blocked: number;     // how many hit the wall this run
};

/**
 * Check Target availability for the given products via their direct product
 * pages. Only products with a pinned `tcin` are monitored; the rest return
 * "unknown" (manual check), exactly like an un-pinned product today. Sequential
 * with a small gap — gentle, human-paced, no aggressive hammering.
 */
export async function getTargetStockDirect(
  products: { id: string; tcin?: number }[]
): Promise<TargetStockResult> {
  const statuses: ProductStock[] = [];
  let monitored = 0;
  let blocked = 0;

  for (const p of products) {
    if (!p.tcin) {
      statuses.push({ productId: p.id, status: "unknown", sku: null, url: null, price: null });
      continue;
    }
    monitored++;
    const r = await checkOne(p.id, p.tcin);
    if (r.blocked) blocked++;
    statuses.push({ productId: r.productId, status: r.status, sku: r.sku, url: r.url, price: r.price });
    await new Promise(res => setTimeout(res, REQUEST_GAP_MS));
  }

  return { statuses, monitored, blocked };
}
