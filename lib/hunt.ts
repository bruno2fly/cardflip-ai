/**
 * Shared hunt-list fetcher: flip-worthy cards from the Pokemon TCG API,
 * pulled across 3 price tiers so the list always mixes cheap, mid-range,
 * and premium cards — which makes the budget filter actually do something.
 * Cached in memory for 1 hour so the list rotates through the day.
 */

export type HuntCard = {
  id: string;
  name: string;
  set: string;
  number: string;
  image: string | null;
  market: number;       // holofoil market price at fetch time
  url: string | null;   // TCGPlayer link
};

export type HuntList = { cards: HuntCard[]; updatedAt: number };

// ------------------------------------------------------------------
// Shared flip math — used by the Hunt List, Scanner, and Lot Analyzer
// ------------------------------------------------------------------

export type VelocityTier = "fast" | "moderate" | "slow";
export type Velocity = { tier: VelocityTier; label: string; days: number; cls: string };

/** How fast a card typically sells, by price bracket. */
export function velocityFor(market: number): Velocity {
  if (market < 75) return { tier: "fast", label: "Sells fast (2–5 days)", days: 5, cls: "bg-green-950/60 border-green-700/40 text-green-400" };
  if (market <= 300) return { tier: "moderate", label: "Moderate (1–2 weeks)", days: 14, cls: "bg-yellow-950/60 border-yellow-700/40 text-yellow-400" };
  return { tier: "slow", label: "Slow move (2–6 weeks)", days: 42, cls: "bg-orange-950/60 border-orange-700/40 text-orange-400" };
}

export type DealScore = { grade: "A" | "B" | "Pass"; label: string; cls: string };

/**
 * One-glance deal grade so a beginner doesn't have to do mental math.
 *   A flip: ROI > 30% AND sells fast AND profit > $12 after fees
 *   B flip: ROI 10–30%, or strong ROI that just moves slower
 *   Pass:   ROI < 10%, profit < $12, or negative ROI
 */
export function dealScore(roi: number, profit: number, tier: VelocityTier): DealScore {
  if (roi < 10 || profit < 12) {
    return { grade: "Pass", label: "Pass", cls: "bg-red-950/80 border-red-700/50 text-red-400" };
  }
  if (roi > 30 && tier === "fast") {
    return { grade: "A", label: "A flip", cls: "bg-green-950/80 border-green-700/50 text-green-400" };
  }
  return { grade: "B", label: "B flip", cls: "bg-yellow-950/80 border-yellow-700/50 text-yellow-400" };
}

// ------------------------------------------------------------------
// Hunt list fetching
// ------------------------------------------------------------------

const TCG_API = "https://api.pokemontcg.io/v2/cards";
const CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour — the list rotates through the day

/**
 * Three price tiers, 10 cards each. Guarantees the list always has cheap,
 * medium, AND expensive cards:
 *   budget $100 hides tiers 2 & 3 · $200 hides tier 3 · $500 shows everything
 */
const TIERS = [
  { label: "cheap", min: 25, max: 80, take: 10 },   // Tier 1 — cheap & fast
  { label: "mid", min: 80, max: 200, take: 10 },    // Tier 2 — mid range
  { label: "premium", min: 200, max: 500, take: 10 } // Tier 3 — premium
] as const;

// Only card types worth flipping: alt art / VMAX / VSTAR / ex / GX / Rainbow Rare
const FLIP_WORTHY = /\b(vmax|vstar|gx|ex)\b|alt art|rainbow rare/i;

let cache: HuntList | null = null;

function apiHeaders(): Record<string, string> {
  return process.env.POKEMONTCG_API_KEY
    ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY }
    : {};
}

/** Fisher–Yates, returns the array it was given (shuffled in place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type RawCard = {
  id: string;
  name: string;
  number: string;
  set?: { name?: string; printedTotal?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: { url?: string; prices?: { holofoil?: { market?: number | null } } };
};

/** Fetch up to 100 flip-worthy cards in one price tier. */
async function fetchTier(min: number, max: number, take: number): Promise<HuntCard[]> {
  const params = new URLSearchParams({
    q: `tcgplayer.prices.holofoil.market:[${min} TO ${max}]`,
    orderBy: "-tcgplayer.prices.holofoil.market",
    pageSize: "100",
    select: "id,name,number,set,images,tcgplayer",
  });

  const res = await fetch(`${TCG_API}?${params}`, {
    headers: apiHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Pokemon TCG API responded ${res.status}`);
  const json = await res.json();

  const pool: HuntCard[] = ((json.data ?? []) as RawCard[])
    .filter((c) => FLIP_WORTHY.test(c.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      set: c.set?.name ?? "",
      number: c.set?.printedTotal ? `${c.number}/${c.set.printedTotal}` : c.number,
      image: c.images?.large ?? c.images?.small ?? null,
      market: c.tcgplayer?.prices?.holofoil?.market ?? 0,
      url: c.tcgplayer?.url ?? null,
    }))
    .filter((c) => c.market >= min && c.market <= max);

  // Shuffle within the tier so each refresh rotates through different cards
  return shuffle(pool).slice(0, take);
}

export async function getHuntList(force = false): Promise<HuntList> {
  if (!force && cache && Date.now() - cache.updatedAt < CACHE_TTL_MS) return cache;

  // Sequential (not parallel) — the free Pokemon TCG API tier rate-limits
  // simultaneous requests. One retry per tier; result is cached for an hour.
  const collected: HuntCard[] = [];
  for (const t of TIERS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        collected.push(...await fetchTier(t.min, t.max, t.take));
        break;
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  const cards = shuffle(collected);

  if (cards.length === 0) {
    // serve stale cache on total upstream failure rather than blowing up
    if (cache) return cache;
    throw new Error("Pokemon TCG API returned no cards for any tier");
  }

  cache = { cards, updatedAt: Date.now() };
  return cache;
}

/** Fetch fresh market prices for a batch of card ids in one API call. */
export async function getLiveMarkets(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const q = ids.map((id) => `id:"${id}"`).join(" OR ");
  const params = new URLSearchParams({
    q,
    pageSize: "250",
    select: "id,tcgplayer",
  });
  const res = await fetch(`${TCG_API}?${params}`, {
    headers: apiHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Pokemon TCG API responded ${res.status}`);
  const json = await res.json();

  for (const c of json.data ?? []) {
    const prices = c.tcgplayer?.prices ?? {};
    const block =
      prices.holofoil ?? prices.normal ?? prices.reverseHolofoil ??
      Object.values(prices)[0];
    const market = (block as { market?: number | null } | undefined)?.market;
    if (market != null) out.set(c.id, market);
  }
  return out;
}
