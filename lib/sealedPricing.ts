/**
 * Live sealed-product market prices via tcgapi.dev (TCGPlayer market data).
 *
 * Endpoint: GET https://api.tcgapi.dev/v1/search?q=NAME&game=pokemon
 * Auth:     X-API-Key: <TCGAPI_DEV_KEY>   (free tier: 100 requests/day)
 *
 * Budget math: 14 products per refresh, cached 60 min, hard-capped at
 * 6 refreshes per instance-day → 84 requests max, under the 100/day cap.
 * We also read the API's own daily_remaining and stop early if it runs low.
 *
 * Defensive pattern (same as lib/stock.ts): never throws — missing key,
 * rate limit, or any error returns nulls and the UI falls back to the
 * manual price input.
 */

export type SealedPrice = {
  productId: string;
  market: number | null;       // live TCGPlayer market price, null = no data
  matchedName: string | null;  // what tcgapi.dev actually matched (sanity check)
};

export type SealedPricingResult = {
  configured: boolean;         // false when TCGAPI_DEV_KEY is missing
  checkedAt: number;
  dailyRemaining: number | null;
  prices: SealedPrice[];
};

const API = "https://api.tcgapi.dev/v1/search";
const CACHE_TTL_MS = 60 * 60 * 1000;  // 60 min
const MAX_REFRESHES_PER_DAY = 6;      // 6 × 14 = 84 requests < 100/day cap
const MIN_REMAINING_TO_REFRESH = 16;  // don't start a refresh we can't finish
const REQUEST_GAP_MS = 150;

let cache: SealedPricingResult | null = null;
let refreshesToday = 0;
let refreshDayKey = "";

function todayKey() { return new Date().toISOString().slice(0, 10); }

/** Prefer the result whose name shares the most words with our product name. */
function pickMatch(results: unknown[], productName: string): { name: string; market: number | null } | null {
  const want = new Set(productName.toLowerCase().split(/\s+/));
  let best: { name: string; market: number | null; score: number } | null = null;
  for (const r of results) {
    const item = r as { name?: string; price?: { market_price?: number | null } };
    if (!item.name) continue;
    const words = item.name.toLowerCase().split(/\s+/);
    const score = words.filter(w => want.has(w)).length / Math.max(words.length, 1);
    const market = typeof item.price?.market_price === "number" ? item.price.market_price : null;
    if (!best || score > best.score || (score === best.score && market != null && best.market == null)) {
      best = { name: item.name, market, score };
    }
  }
  // require a majority word overlap so "Charizard ex" can't match an ETB query
  return best && best.score >= 0.5 ? { name: best.name, market: best.market } : null;
}

function readDailyRemaining(json: unknown, res: Response): number | null {
  const j = json as { rate_limit?: { daily_remaining?: number }; meta?: { daily_remaining?: number } };
  const fromBody = j.rate_limit?.daily_remaining ?? j.meta?.daily_remaining;
  if (typeof fromBody === "number") return fromBody;
  const fromHeader = res.headers.get("x-ratelimit-remaining") ?? res.headers.get("x-daily-remaining");
  const n = fromHeader ? parseInt(fromHeader, 10) : NaN;
  return isNaN(n) ? null : n;
}

export async function getSealedPrices(
  products: { id: string; name: string }[]
): Promise<SealedPricingResult> {
  const apiKey = process.env.TCGAPI_DEV_KEY;

  if (!apiKey) {
    return {
      configured: false,
      checkedAt: Date.now(),
      dailyRemaining: null,
      prices: products.map(p => ({ productId: p.id, market: null, matchedName: null })),
    };
  }

  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache;

  // reset the per-day refresh counter when the date rolls over
  if (refreshDayKey !== todayKey()) {
    refreshDayKey = todayKey();
    refreshesToday = 0;
  }
  if (refreshesToday >= MAX_REFRESHES_PER_DAY) {
    console.warn(`[sealedPricing] daily refresh cap (${MAX_REFRESHES_PER_DAY}) reached — serving stale prices`);
    if (cache) return cache;
    return {
      configured: true,
      checkedAt: Date.now(),
      dailyRemaining: null,
      prices: products.map(p => ({ productId: p.id, market: null, matchedName: null })),
    };
  }
  refreshesToday++;

  let dailyRemaining: number | null = null;
  const prices: SealedPrice[] = [];

  for (const p of products) {
    // stop early if the API says we're nearly out of daily budget
    if (dailyRemaining != null && dailyRemaining < MIN_REMAINING_TO_REFRESH) {
      console.warn(`[sealedPricing] tcgapi.dev daily budget low (${dailyRemaining} left) — stopping refresh early`);
      prices.push({ productId: p.id, market: null, matchedName: null });
      continue;
    }
    try {
      const url = `${API}?q=${encodeURIComponent(p.name)}&game=pokemon`;
      const res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
      });
      if (!res.ok) {
        prices.push({ productId: p.id, market: null, matchedName: null });
        continue;
      }
      const json = await res.json();
      dailyRemaining = readDailyRemaining(json, res) ?? dailyRemaining;
      const match = pickMatch(json.data ?? [], p.name);
      prices.push({
        productId: p.id,
        market: match?.market ?? null,
        matchedName: match?.name ?? null,
      });
    } catch {
      prices.push({ productId: p.id, market: null, matchedName: null });
    }
    await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
  }

  if (dailyRemaining != null && dailyRemaining < 30) {
    console.warn(`[sealedPricing] tcgapi.dev daily budget getting close: ${dailyRemaining} requests left today`);
  }

  cache = { configured: true, checkedAt: Date.now(), dailyRemaining, prices };
  return cache;
}
