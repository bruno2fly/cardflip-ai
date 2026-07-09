import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TCG_API = "https://api.pokemontcg.io/v2/cards";
const SELECT = "id,name,number,set,rarity,tcgplayer,images";

type TcgPriceBlock = {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
};

type TcgCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: { id: string; name: string; printedTotal?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, TcgPriceBlock>;
  };
};

/** Strip grading/finish suffixes people add to card names ("PSA 10", "Alt Art"…) */
function cleanName(raw: string): string {
  return raw
    .replace(/\bPSA\s*\d+(\.\d+)?\b/gi, "")
    .replace(/\b(BGS|CGC)\s*\d+(\.\d+)?\b/gi, "")
    .replace(/\b(rainbow rare|secret rare|rare rainbow|alt art|full art|rainbow|gold|raw|nm|lp)\b/gi, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preferred print variants, most representative first */
const VARIANT_PRIORITY = [
  "holofoil",
  "normal",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "unlimitedHolofoil",
  "1stEdition",
  "unlimited",
];

function pickVariant(prices: Record<string, TcgPriceBlock>): { variant: string; block: TcgPriceBlock } | null {
  for (const v of VARIANT_PRIORITY) {
    if (prices[v]?.market != null || prices[v]?.mid != null) return { variant: v, block: prices[v] };
  }
  const first = Object.entries(prices).find(([, b]) => b && (b.market != null || b.mid != null));
  return first ? { variant: first[0], block: first[1] } : null;
}

async function queryCards(q: string): Promise<TcgCard[]> {
  const params = new URLSearchParams({
    q,
    pageSize: "12",
    orderBy: "-set.releaseDate",
    select: SELECT,
  });
  const headers: Record<string, string> = {};
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  const res = await fetch(`${TCG_API}?${params}`, {
    headers,
    // cache upstream responses for 5 minutes to stay under rate limits
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Pokemon TCG API responded ${res.status}`);
  const json = await res.json();
  return (json.data ?? []) as TcgCard[];
}

/**
 * GET /api/prices?name=CARDNAME[&set=SETNAME][&number=215/203]
 *
 * Returns live TCGPlayer market prices via the Pokemon TCG API `tcgplayer` field:
 * { query, matched: {id,name,set,number,image}, variant, prices: {low,mid,high,market,directLow}, url, updatedAt }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawName = searchParams.get("name")?.trim();
  const set = searchParams.get("set")?.trim();
  const number = searchParams.get("number")?.trim();

  if (!rawName) {
    return NextResponse.json({ error: "Missing required query param: name" }, { status: 400 });
  }

  const name = cleanName(rawName);
  if (!name) {
    return NextResponse.json({ error: "Card name is empty after cleanup" }, { status: 400 });
  }

  try {
    // Attempt 1: exact name (+ set when provided). Attempt 2: exact name only.
    // Attempt 3: wildcard match on the name.
    const attempts: string[] = [];
    if (set) attempts.push(`name:"${name}" set.name:"${set.replace(/\s*\d{4}$/, "")}"`);
    attempts.push(`name:"${name}"`);
    // Wildcard fallbacks: people often prefix the set ("Base Set Charizard"),
    // so the Pokemon name is usually the LAST word — try it before the first.
    const words = name.split(" ");
    if (words.length > 1) attempts.push(`name:*${words[words.length - 1]}*`);
    attempts.push(`name:*${words[0]}*`);

    let cards: TcgCard[] = [];
    for (const q of attempts) {
      cards = await queryCards(q);
      if (cards.length > 0) break;
    }

    // Prefer the printed-number match (e.g. "215" from "215/203"), then the
    // priced card whose name overlaps the query the most (guards wildcard hits).
    const printedNumber = number?.split("/")[0]?.trim();
    const priced = cards.filter((c) => c.tcgplayer?.prices && Object.keys(c.tcgplayer.prices).length > 0);
    const qWords = new Set(name.toLowerCase().split(" "));
    const overlap = (c: TcgCard) => {
      const nWords = c.name.toLowerCase().split(/\s+/);
      return nWords.filter((w) => qWords.has(w)).length / nWords.length;
    };
    const bestByOverlap = [...priced].sort((a, b) => overlap(b) - overlap(a))[0];
    const match =
      (printedNumber && priced.find((c) => c.number === printedNumber)) ||
      bestByOverlap;

    if (!match) {
      return NextResponse.json(
        { error: `No priced TCGPlayer match found for "${rawName}"`, query: name },
        { status: 404 }
      );
    }

    const picked = pickVariant(match.tcgplayer!.prices!);
    if (!picked) {
      return NextResponse.json(
        { error: `Match found but no usable price data for "${rawName}"`, query: name },
        { status: 404 }
      );
    }

    return NextResponse.json({
      query: name,
      matched: {
        id: match.id,
        name: match.name,
        set: match.set?.name ?? null,
        number: match.set?.printedTotal ? `${match.number}/${match.set.printedTotal}` : match.number,
        rarity: match.rarity ?? null,
        image: match.images?.large ?? match.images?.small ?? null,
      },
      source: "tcgplayer",
      variant: picked.variant,
      prices: {
        low: picked.block.low ?? null,
        mid: picked.block.mid ?? null,
        high: picked.block.high ?? null,
        market: picked.block.market ?? picked.block.mid ?? null,
        directLow: picked.block.directLow ?? null,
      },
      url: match.tcgplayer?.url ?? null,
      updatedAt: match.tcgplayer?.updatedAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Price lookup failed: ${message}` }, { status: 502 });
  }
}
