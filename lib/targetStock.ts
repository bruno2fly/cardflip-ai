/**
 * Target availability via the DIRECT product page (ghost-stock monitoring).
 *
 * Why not RedSky: Target's RedSky JSON API and search/category views are
 * client-rendered through an Akamai-walled endpoint that 403s/CAPTCHAs cloud
 * IPs. But the individual product page at target.com/p/-/A-<TCIN> is
 * server-rendered and, as of testing, loads real HTML from cloud IPs.
 *
 * This is READ-ONLY fetching of publicly visible retail data — exactly what a
 * browser does when you open the listing (phase 1), plus the same follow-up
 * call the page's own JavaScript makes to Target's deferred-enrichment
 * endpoint to fill in real-time availability (phase 2). No cart, checkout,
 * account, or payment logic. If a request comes back as an Akamai/CAPTCHA
 * challenge instead of real product HTML, we mark it "blocked" and degrade
 * to unknown. We do NOT retry hard or attempt to defeat the wall.
 *
 * Products opt in by pinning a verified `targetTcin` (see lib/products.ts) —
 * same pattern as tcgProductId. Bulk auto-resolution isn't possible because
 * Target's search API is the walled one; TCINs are resolved out-of-band
 * (public web search) and verified against a live product page before pinning.
 */

import type { StockState, ProductStock } from "@/lib/stock";

// LIVE INCIDENT (Sep 16, 2026, ~2:54am-3:1Xam ET): /api/cron/stock 504-timed
// out on EVERY run right through the actual 30th Celebration drop window.
// Root cause: with the default 40-per-run cap, this checker was ALREADY
// marginal (40 sequential fetches x up to 9s timeout + 400ms gap each can
// exceed the cron's 30s maxDuration on its own if even a few requests are
// slow) — and real drop-night traffic on Target's side pushed individual
// requests slower/more often into the wall, tipping it over. Cutting the
// per-check timeout and relying on TARGET_MAX_CHECKS_PER_RUN (set lower via
// Vercel env, see route.ts comment) to keep worst-case run time inside
// budget.
//
// SECOND LIVE INCIDENT (same night, ~4:40am-5:00am ET, discovered by Bruno
// manually checking Target and finding an item buyable that we reported
// out-of-stock): the raw HTML the server-rendered page ships is a LOADING
// SKELETON for the buy button — every Add-to-cart button in the initial HTML
// carries `disabled=""` regardless of true availability; Target's own
// front-end JS resolves the real state client-side by calling a
// "deferred_enrichment" endpoint after page load. Our server-side fetch never
// runs that JS, so `parseTargetHtml`'s button-disabled check can be flat-out
// WRONG (confirmed live: TCIN 1010892078 showed `disabled` in raw HTML while
// genuinely in-stock/shippable — verified 3x with a real rendered browser and
// cross-checked against Target's own fulfillment API, which agreed it was
// in-stock). Fix: after the HTML fetch, make the SAME follow-up call the
// page's own JS makes (`/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/
// modules`) using values already embedded in the HTML's __NEXT_DATA__ blob
// (page_context, visitor_id, and the FulfillmentAndVariations module's
// enrichment_context — no separate auth/session needed), and read the real
// `fulfillment.shipping_options.availability_status` /
// `fulfillment.sold_out` fields. The HTML button read is now only a FALLBACK
// for when this second call fails for any reason (network, shape change,
// bot-wall) — it can never make things worse than before, only better.
const PAGE_TIMEOUT_MS = 4000;
const API_TIMEOUT_MS = 3000;
const REQUEST_GAP_MS = 250;
const CONCURRENCY = 3; // small parallel pool so the added 2nd call doesn't blow the per-branch 20s cron deadline
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
// Public web key Target's own site bakes into every PDP's API calls (not a
// secret — same value ships in every visitor's page source). Extracted live
// and confirmed working Sep 16, 2026; also re-extracted per-request from the
// fetched HTML when possible as a defensive fallback if Target rotates it.
const TARGET_WEB_KEY_FALLBACK = "9f36aeafbe60771e321a7cc95a78140772ab3e96";

/** Internal result adds "blocked" (a wall hit) which maps to "unknown" upstream. */
export type TargetPageState = StockState | "blocked";

export function productUrl(tcin: number | string): string {
  return `https://www.target.com/p/-/A-${tcin}`;
}

const CHALLENGE_MARKERS = ["Pardon Our Interruption", "Access Denied", "Bot Manager", "Request unsuccessful. Incapsula"];

/**
 * Parse availability out of a Target product-page HTML string.
 *
 * IMPORTANT: this reads the server-rendered Add-to-cart button, which is a
 * LOADING SKELETON — it is `disabled` in the raw HTML for both true
 * out-of-stock AND some true in-stock products, resolved only by client-side
 * JS after load (see incident note above). This function is kept as a
 * best-effort FALLBACK (used when the real fulfillment-API call in
 * `checkOne` fails) and for the unrelated bot-wall/challenge detection it
 * also performs — it is no longer the primary signal for in-stock detection.
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
    // Disabled button on a real product page = genuinely out of stock
    // (usually true, but see incident note — this can be a loading skeleton).
    if (isRealProduct) return "out-of-stock";
    return "unknown";
  }

  // Text-marker fallback when the button shape shifts.
  if (/out of stock|sold out|temporarily out of stock/i.test(html)) return "out-of-stock";
  if (isRealProduct && /add to cart|add for shipping/i.test(html)) return "in-stock";

  // Real product page but no signal we trust, or a non-product shell.
  return isRealProduct ? "unknown" : "blocked";
}

/** Extract the `__NEXT_DATA__` JSON blob embedded in a Target PDP page. */
function extractNextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Recursively find the first string value for `key` anywhere in a JSON tree. */
function findStringKey(obj: unknown, key: string): string | null {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findStringKey(v, key);
      if (r) return r;
    }
    return null;
  }
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    if (typeof rec[key] === "string") return rec[key] as string;
    for (const k of Object.keys(rec)) {
      const r = findStringKey(rec[k], key);
      if (r) return r;
    }
  }
  return null;
}

type FavModuleRef = { enrichment_context: string; module_placement_id: string };

/** Find the ProductDetailWebDatasourceFulfillmentAndVariations module reference in __NEXT_DATA__. */
function findFulfillmentModuleRef(nextData: unknown): FavModuleRef | null {
  try {
    const props = (nextData as Record<string, unknown>)?.props as Record<string, unknown> | undefined;
    const dehydratedState = props?.dehydratedState as Record<string, unknown> | undefined;
    const queries = dehydratedState?.queries as unknown[] | undefined;
    if (!Array.isArray(queries)) return null;
    for (const q of queries) {
      try {
        const state = (q as Record<string, unknown>)?.state as Record<string, unknown> | undefined;
        const data = state?.data as Record<string, unknown> | undefined;
        const inner = data?.data as Record<string, unknown> | undefined;
        const mods = inner?.data_source_modules as unknown[] | undefined;
        if (Array.isArray(mods)) {
          const fav = mods.find(
            (m) => (m as Record<string, unknown>)?.module_type === "ProductDetailWebDatasourceFulfillmentAndVariations"
          ) as Record<string, unknown> | undefined;
          if (fav && typeof fav.enrichment_context === "string") {
            return {
              enrichment_context: fav.enrichment_context,
              module_placement_id:
                typeof fav.module_placement_id === "string"
                  ? fav.module_placement_id
                  : "ProductDetailWebDatasourceFulfillmentAndVariations",
            };
          }
        }
      } catch {
        // try next query
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractWebKey(html: string): string | null {
  const m = html.match(/[?&]key=([a-f0-9]{40})/);
  return m ? m[1] : null;
}

type FulfillmentData = {
  sold_out?: boolean;
  is_out_of_stock_in_all_store_locations?: boolean;
  shipping_options?: { availability_status?: string };
};

/** Map Target's real fulfillment object to our StockState, or null if ambiguous. */
function stockFromFulfillment(fulfillment: FulfillmentData | null | undefined): StockState | null {
  if (!fulfillment) return null;
  if (fulfillment.sold_out === true) return "out-of-stock";
  const shipStatus = fulfillment.shipping_options?.availability_status;
  if (shipStatus === "IN_STOCK") return "in-stock";
  if (shipStatus === "OUT_OF_STOCK") return "out-of-stock";
  return null; // UNAVAILABLE / missing / unrecognized — let caller fall back
}

/**
 * Phase 2: call Target's own deferred-enrichment endpoint (the same one the
 * PDP's client-side JS calls after load) for the real fulfillment signal.
 * Returns null on ANY failure (network, timeout, shape change, bot-wall) so
 * the caller can safely fall back to the HTML-button read.
 */
async function fetchFulfillmentState(html: string, tcin: number, timeoutMs: number): Promise<StockState | null> {
  const nextData = extractNextData(html);
  if (!nextData) return null;
  const pageContext = findStringKey(nextData, "page_context");
  const visitorId = findStringKey(nextData, "visitor_id");
  const favRef = findFulfillmentModuleRef(nextData);
  if (!pageContext || !visitorId || !favRef) return null;

  const key = extractWebKey(html) ?? TARGET_WEB_KEY_FALLBACK;
  const params = new URLSearchParams({
    auth: "true",
    tcin: String(tcin),
    channel: "WEB",
    page: `/p/A-${tcin}`,
    visitor_id: visitorId,
    key,
  });
  const url = `https://www.target.com/cdui_orchestrations/v1/pages/pdp/deferred_enrichment/modules?${params.toString()}`;
  const body = JSON.stringify({
    page_context: pageContext,
    modules: [
      {
        module_placement_id: favRef.module_placement_id,
        module_type: "ProductDetailWebDatasourceFulfillmentAndVariations",
        enrichment_context: favRef.enrichment_context,
      },
    ],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Content-Type": "application/json",
        Referer: productUrl(tcin),
      },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { modules?: unknown[] };
    const mod = (data.modules ?? []).find(
      (m) => (m as Record<string, unknown>)?.module_type === "ProductDetailWebDatasourceFulfillmentAndVariations"
    ) as Record<string, unknown> | undefined;
    const moduleData = mod?.module_data as Record<string, unknown> | undefined;
    const inner = moduleData?.data as Record<string, unknown> | undefined;
    const product = inner?.product as Record<string, unknown> | undefined;
    const fulfillment = product?.fulfillment as FulfillmentData | undefined;
    return stockFromFulfillment(fulfillment ?? null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(productId: string, tcin: number): Promise<ProductStock & { blocked: boolean }> {
  const url = productUrl(tcin);

  // Phase 1: fetch the product page HTML.
  const pageController = new AbortController();
  const pageTimer = setTimeout(() => pageController.abort(), PAGE_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(url, {
      signal: pageController.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      // 403/429 = wall; anything non-200 → unknown, never a false "in stock"
      const blocked = res.status === 403 || res.status === 429;
      return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked };
    }
    html = await res.text();
  } catch {
    // timeout / network → unknown, treated the same as a soft block
    return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked: true };
  } finally {
    clearTimeout(pageTimer);
  }

  const buttonState = parseTargetHtml(html);
  if (buttonState === "blocked") {
    console.warn(`[targetStock] ${productId} (TCIN ${tcin}): bot-wall/challenge or unparseable — degrading to unknown`);
    return { productId, status: "unknown", sku: String(tcin), url, price: null, blocked: true };
  }

  // Phase 2: real fulfillment signal (see incident note at top of file for
  // why the HTML button alone is not trustworthy). Falls back to the button
  // read on any failure — never worse than the old behavior, only better.
  try {
    const apiState = await fetchFulfillmentState(html, tcin, API_TIMEOUT_MS);
    if (apiState) {
      return { productId, status: apiState, sku: String(tcin), url, price: null, blocked: false };
    }
  } catch {
    // fall through to button-based read below
  }

  return { productId, status: buttonState, sku: String(tcin), url, price: null, blocked: false };
}

export type TargetStockResult = {
  statuses: ProductStock[];
  monitored: number;   // products that had a pinned TCIN
  blocked: number;     // how many hit the wall this run
};

/**
 * Stateless round-robin batch selection.
 *
 * WHY: we check Target product pages with a REQUEST_GAP_MS pause between
 * batches (deliberately gentle, human-paced), through a small concurrent
 * pool (CONCURRENCY) so the 2-call-per-product check (page + fulfillment API)
 * still fits inside the cron's per-branch time budget. Once the monitored set
 * grows large (the Target catalog makes up to 639 products trackable),
 * checking all of them every run would both overrun the window and hammer
 * Target. So instead of checking harder, we round-robin: each run checks up
 * to `maxPerRun` TCINs, advancing the window every run, so every product is
 * covered within ceil(N/maxPerRun) runs.
 *
 * STATELESS: the window index comes from wall-clock time (which interval we're
 * in), so no cursor is stored and consecutive runs land on different slices.
 * The list is sorted by a stable key first so slices don't reshuffle run to run.
 */
export function selectRoundRobinBatch<T>(
  items: T[],
  keyOf: (item: T) => string | number,
  maxPerRun: number,
  intervalMs: number,
  now: number = Date.now()
): T[] {
  if (maxPerRun <= 0 || items.length <= maxPerRun) return items;
  const sorted = [...items].sort((a, b) => String(keyOf(a)).localeCompare(String(keyOf(b))));
  const batches = Math.ceil(sorted.length / maxPerRun);
  const index = Math.floor(now / Math.max(1, intervalMs)) % batches;
  const start = index * maxPerRun;
  return sorted.slice(start, start + maxPerRun);
}

export type TargetBatchOptions = {
  /** Max TCINs to actually fetch this run; the rest are skipped (not fetched). */
  maxPerRun: number;
  /** Cron cadence in ms — advances the round-robin window one step per run. */
  intervalMs: number;
  now?: number;
};

/**
 * Check Target availability for the given products via their direct product
 * pages + Target's own fulfillment API (see incident note at top of file).
 * Only products with a pinned `tcin` are monitored; the rest return
 * "unknown" (manual check), exactly like an un-pinned product today. Checked
 * through a small concurrent pool with a gap between dispatches — gentle,
 * human-paced, no aggressive hammering.
 *
 * When `batch` is passed AND more TCINs are monitored than `maxPerRun`, only a
 * rotating slice is fetched this run; the un-selected TCIN products are simply
 * omitted from the result (NOT reported as "unknown"), so a caller like the
 * stock cron never sees a spurious state change for a product it just didn't
 * check this cycle. Small lists (and callers that pass no `batch`) check
 * everything, exactly as before — this is purely additive.
 */
export async function getTargetStockDirect(
  products: { id: string; tcin?: number }[],
  batch?: TargetBatchOptions
): Promise<TargetStockResult> {
  const statuses: ProductStock[] = [];
  let blocked = 0;

  const withTcin = products.filter((p): p is { id: string; tcin: number } => Boolean(p.tcin));
  const withoutTcin = products.filter(p => !p.tcin);

  // Products with no TCIN are free (no fetch) — always pass through as unknown,
  // preserving today's shape for the caller.
  for (const p of withoutTcin) {
    statuses.push({ productId: p.id, status: "unknown", sku: null, url: null, price: null });
  }

  // Round-robin only engages when batching is requested and the set is large.
  const toCheck = batch
    ? selectRoundRobinBatch(withTcin, p => p.tcin, batch.maxPerRun, batch.intervalMs, batch.now)
    : withTcin;
  const monitored = toCheck.length;

  const results: (ProductStock & { blocked: boolean })[] = new Array(toCheck.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < toCheck.length) {
      const i = nextIndex++;
      const p = toCheck[i];
      results[i] = await checkOne(p.id, p.tcin);
      if (nextIndex < toCheck.length) {
        await new Promise(res => setTimeout(res, REQUEST_GAP_MS));
      }
    }
  }
  const workerCount = Math.min(CONCURRENCY, toCheck.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const r of results) {
    if (!r) continue;
    if (r.blocked) blocked++;
    statuses.push({ productId: r.productId, status: r.status, sku: r.sku, url: r.url, price: r.price });
  }

  return { statuses, monitored, blocked };
}
