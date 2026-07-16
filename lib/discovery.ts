/**
 * Live sealed-product discovery.
 *
 * Two sources feed candidates:
 *   1. tcgplayer-trending — keyless sweep of TCGPlayer's sales-ranked search
 *      (mp-search-api, verified reachable from datacenter IPs). Works in
 *      production TODAY with zero configuration.
 *   2. brave-search — Brave Web Search API, only when BRAVE_SEARCH_API_KEY
 *      is set (free tier exists at brave.com/search/api). Skipped cleanly
 *      when the key is missing — never faked.
 *
 * Every candidate must pass REAL verification before users ever see it:
 * exact-ish TCGPlayer match (majority word overlap) + live pricepoints
 * market price + product image returning HTTP 200. No match → 'rejected'.
 */

export type DiscoverySource = "tcgplayer-trending" | "brave-search";

export type Candidate = {
  name: string;
  source: DiscoverySource;
  signal: string;             // the query/snippet that surfaced it
  tcgProductId?: number;      // pre-known when the source is TCGPlayer itself
};

export type Verification = {
  tcgProductId: number;
  verifiedName: string;
  market: number;
  productType: ProductTypeGuess;
  msrp: number;
};

export type ProductTypeGuess = "ETB" | "Booster Box" | "Booster Bundle" | "Premium Collection";

const MP_SEARCH = "https://mp-search-api.tcgplayer.com/v1/search/request";
const PRICEPOINTS = "https://mpapi.tcgplayer.com/v2/product";
const CDN_IMG = (id: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_400x400.jpg`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

// SKU noise we never want as products (cases, displays, half boxes, club bundles…)
const JUNK = /\b(case|display|half booster|art bundle|sleeved booster pack|\(lgs\)|costco|sam's club|3-pack|blister|checklane|mini tin|tin\b|set of \d)/i;

const TYPE_PATTERNS: [RegExp, ProductTypeGuess][] = [
  [/elite trainer box/i, "ETB"],
  [/booster box/i, "Booster Box"],
  [/booster bundle/i, "Booster Bundle"],
  [/premium collection/i, "Premium Collection"],
];

/** Assumed MSRP by product type (current SV/ME-era retail pricing). */
export function assumedMsrp(type: ProductTypeGuess): number {
  switch (type) {
    case "ETB": return 49.99;
    case "Booster Box": return 161.64;
    case "Booster Bundle": return 26.94;
    case "Premium Collection": return 59.99;
  }
}

export function guessType(name: string): ProductTypeGuess | null {
  for (const [re, t] of TYPE_PATTERNS) if (re.test(name)) return t;
  return null;
}

type MpHit = { productId: number; productName: string };

async function mpSearch(q: string, size = 12): Promise<MpHit[]> {
  const body = JSON.stringify({
    algorithm: "sales_synonym_v2",
    from: 0,
    size,
    filters: { term: { productLineName: ["pokemon"], productTypeName: ["Sealed Products"] } },
    context: { cart: {}, shippingCountry: "US" },
  });
  const res = await fetch(`${MP_SEARCH}?q=${encodeURIComponent(q)}&isList=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body,
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = await res.json();
  return ((json?.results?.[0]?.results ?? []) as { productId: number; productName: string }[])
    .map(h => ({ productId: Math.trunc(h.productId), productName: h.productName }));
}

/**
 * Source 1 — TCGPlayer's own sales ranking: what's actually selling right now.
 * Keyless, and the candidates come with their product ids attached.
 */
export async function discoverFromTcgTrending(): Promise<Candidate[]> {
  const queries = ["elite trainer box", "booster box", "booster bundle", "premium collection"];
  const out: Candidate[] = [];
  for (const q of queries) {
    try {
      const hits = await mpSearch(q, 10);
      for (const h of hits) {
        if (JUNK.test(h.productName)) continue;
        if (!guessType(h.productName)) continue;
        out.push({
          name: h.productName,
          source: "tcgplayer-trending",
          signal: `sales-ranked result for "${q}"`,
          tcgProductId: h.productId,
        });
      }
    } catch { /* one query failing never kills the sweep */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return out;
}

/** Extract "{Set Name} {Product Type}" phrases from arbitrary search-result text. */
export function extractCandidatesFromText(text: string, signal: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const re = /([A-Z0-9][A-Za-z0-9'&:\-é]{1,28}(?:\s+[A-Z0-9][A-Za-z0-9'&:\-é]{1,28}){0,3})\s+(Elite Trainer Box|Booster Box|Booster Bundle|Premium Collection)/g;
  // run per sentence so a capture can never leak across a sentence boundary
  for (const sentence of text.split(/[.!?\n|]+/)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      let prefix = m[1].trim();
      // strip leading filler words repeatedly ("Price The 30th…" → "30th…")
      for (let guard = 0; guard < 4; guard++) {
        const next = prefix.replace(
          /^(The|A|An|Every|New|Latest|Hottest|Price|Date|Preorders?|Buy|Get|This|That|Pok.{0,2}mon(?:\s+TCG)?)\s+/i, ""
        );
        if (next === prefix) break;
        prefix = next;
      }
      if (prefix.length < 3) continue;
      const name = `${prefix} ${m[2]}`;
      if (JUNK.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, source: "brave-search", signal });
    }
  }
  return out;
}

/** Source 2 — Brave Web Search (needs BRAVE_SEARCH_API_KEY; skipped without it). */
export async function discoverFromBrave(): Promise<{ configured: boolean; candidates: Candidate[] }> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { configured: false, candidates: [] };

  const queries = [
    "pokemon tcg booster box sold out 2026",
    "pokemon tcg elite trainer box restock",
    "hottest pokemon tcg set this month",
    "pokemon tcg presale hype",
  ];
  const candidates: Candidate[] = [];
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`,
        { headers: { "X-Subscription-Token": key, Accept: "application/json" }, cache: "no-store" }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const text = ((json?.web?.results ?? []) as { title?: string; description?: string }[])
        .map(r => `${r.title ?? ""}. ${r.description ?? ""}`)
        .join(" \n ");
      candidates.push(...extractCandidatesFromText(text, `brave: "${q}"`));
    } catch { /* isolated per query */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return { configured: true, candidates };
}

/**
 * REAL verification — a candidate is only shown to users after all three:
 *   1. TCGPlayer search finds a product whose name majority-overlaps the candidate
 *   2. pricepoints returns a live Normal market price
 *   3. the product image CDN returns HTTP 200
 */
export async function verifyCandidate(c: Candidate): Promise<Verification | null> {
  try {
    let productId = c.tcgProductId ?? null;
    let matchedName = c.tcgProductId ? c.name : null;

    if (!productId) {
      const hits = await mpSearch(c.name, 6);
      const want = new Set(c.name.toLowerCase().split(/\s+/));
      let best: { id: number; name: string; score: number } | null = null;
      for (const h of hits) {
        if (JUNK.test(h.productName)) continue;
        const words = h.productName.toLowerCase().split(/\s+/);
        const score = words.filter(w => want.has(w)).length / Math.max(words.length, 1);
        if (!best || score > best.score) best = { id: h.productId, name: h.productName, score };
      }
      if (!best || best.score < 0.6) return null; // no confident real match → rejected
      productId = best.id;
      matchedName = best.name;
    }

    const type = guessType(matchedName ?? c.name);
    if (!type) return null;

    // live market price
    const pp = await fetch(`${PRICEPOINTS}/${productId}/pricepoints`, {
      headers: { "User-Agent": UA }, cache: "no-store",
    });
    if (!pp.ok) return null;
    const points = await pp.json();
    const normal = Array.isArray(points)
      ? points.find((p: { printingType?: string }) => p.printingType === "Normal") ?? points[0]
      : null;
    const market = typeof normal?.marketPrice === "number" ? normal.marketPrice : null;
    if (market == null || market <= 0) return null;

    // live product image
    const img = await fetch(CDN_IMG(productId), { method: "HEAD", cache: "no-store" });
    if (!img.ok) return null;

    return {
      tcgProductId: productId,
      verifiedName: matchedName ?? c.name,
      market,
      productType: type,
      msrp: assumedMsrp(type),
    };
  } catch {
    return null;
  }
}
