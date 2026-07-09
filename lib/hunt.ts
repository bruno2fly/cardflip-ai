/**
 * Shared hunt-list fetcher: top traded flip-worthy cards from the Pokemon TCG API,
 * sorted by TCGPlayer holofoil market price (desc), $30–$3000 sweet spot.
 * Cached in memory for 6 hours so we don't hammer the API.
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

const TCG_API = "https://api.pokemontcg.io/v2/cards";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PRICE_MIN = 15;
const PRICE_MAX = 80;
const LIST_SIZE = 30;

// Only card types worth flipping: alt art / VMAX / VSTAR / ex / GX / Rainbow Rare
const FLIP_WORTHY = /\b(vmax|vstar|gx|ex)\b|alt art|rainbow rare/i;

let cache: HuntList | null = null;

function apiHeaders(): Record<string, string> {
  return process.env.POKEMONTCG_API_KEY
    ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY }
    : {};
}

export async function getHuntList(force = false): Promise<HuntList> {
  if (!force && cache && Date.now() - cache.updatedAt < CACHE_TTL_MS) return cache;

  const params = new URLSearchParams({
    q: `tcgplayer.prices.holofoil.market:[${PRICE_MIN} TO ${PRICE_MAX}]`,
    orderBy: "-tcgplayer.prices.holofoil.market",
    pageSize: "250",
    select: "id,name,number,set,images,tcgplayer",
  });

  const res = await fetch(`${TCG_API}?${params}`, {
    headers: apiHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    // serve stale cache on upstream failure rather than blowing up
    if (cache) return cache;
    throw new Error(`Pokemon TCG API responded ${res.status}`);
  }
  const json = await res.json();

  type Raw = {
    id: string;
    name: string;
    number: string;
    set?: { name?: string; printedTotal?: number };
    images?: { small?: string; large?: string };
    tcgplayer?: { url?: string; prices?: { holofoil?: { market?: number | null } } };
  };

  const cards: HuntCard[] = ((json.data ?? []) as Raw[])
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
    .filter((c) => c.market >= PRICE_MIN && c.market <= PRICE_MAX)
    .slice(0, LIST_SIZE);

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
