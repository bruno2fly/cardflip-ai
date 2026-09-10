/**
 * Target catalog data layer.
 *
 * Loads a scraped snapshot of Target's Pokémon TCG category (639 products as of
 * the first import) from `data-imports/target_catalog_<YYYY-MM-DD>.json` and
 * exposes it as a typed, normalized list. Each raw entry carries a real, direct
 * Target product URL and TCIN, which is exactly what the existing direct-page
 * stock checker (lib/targetStock.ts, keyed by TCIN) needs — so wiring this in
 * turns all 639 into monitorable products instead of the handful pinned by hand
 * in lib/products.ts.
 *
 * SERVER-ONLY. This module reads the filesystem, so it must never be imported
 * from a client component. The catalog reaches the browser through
 * /api/target-catalog, never by direct import.
 *
 * The scrape itself is produced out-of-band (Comet/Perplexity over Target's
 * live category page) — this module does NOT scrape. To refresh, drop a newer
 * `target_catalog_<date>.json` into data-imports/ and it is picked up
 * automatically (newest filename wins); see data-imports/README.md.
 */

import fs from "node:fs";
import path from "node:path";

/** One product as it appears in the scraped JSON (messy, retailer-shaped). */
type RawCatalogEntry = {
  tcin: string;
  url: string;
  price: string | null; // e.g. "$69.99"
  stock: string | null; // e.g. "In Stock" / "Out of Stock" — scrape-time only
  release_date: string | null;
  raw_row?: string;
};

/** Normalized, typed catalog entry the rest of the app consumes. */
export type TargetCatalogEntry = {
  tcin: number;
  url: string;
  name: string; // derived from the URL slug (see deriveNameFromUrl)
  price: number | null; // parsed from "$69.99"; null when the scrape had none
  stock: string | null; // scrape-time snapshot; NOT authoritative (the live
  //                        checker verifies) — kept only as a hint in the UI
  releaseDate: string | null;
};

const CATALOG_DIR = path.join(process.cwd(), "data-imports");
const CATALOG_GLOB = /^target_catalog_.*\.json$/i;

/** Parse "$69.99" → 69.99; returns null for empty/garbage. */
export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/([\d,]+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive a human-readable product name from a Target product URL.
 *
 * Target slugs look like:
 *   /p/pok-233-mon-trading-card-game-30th-celebration-elite-trainer-box/-/A-1010892076
 * The `-233-` is a mangled "é" (char code 233) from the scrape, so "pok-233-mon"
 * is "Pokémon". We fix that token specifically rather than blanket-decoding every
 * `-<digits>-` run, because real set names contain numbers (e.g. "Pokemon 151")
 * that must not be turned into control characters.
 */
export function deriveNameFromUrl(url: string): string {
  const slugMatch = url.match(/\/p\/(.+?)\/-\/A-/i);
  let slug = slugMatch ? slugMatch[1] : url;

  slug = slug
    // "pok-233-mon" / "pok233mon" / "pok-233mon" → "pokemon" (the only encoded
    // entity we've observed); also patches the observed scrape typo "tading".
    .replace(/pok-?233-?mon/gi, "pokemon")
    .replace(/\btading\b/gi, "trading")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Title-case for display, but keep short all-caps-ish tokens readable.
  return slug
    .split(" ")
    .map(w => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

let cached: TargetCatalogEntry[] | null = null;
let cachedFile: string | null = null;

/** Absolute path of the newest catalog file, or null if none exists. */
export function newestCatalogFile(): string | null {
  try {
    const files = fs
      .readdirSync(CATALOG_DIR)
      .filter(f => CATALOG_GLOB.test(f))
      .sort(); // date-stamped names sort lexicographically == chronologically
    if (files.length === 0) return null;
    return path.join(CATALOG_DIR, files[files.length - 1]);
  } catch {
    return null;
  }
}

/** Normalize one raw entry; returns null when it lacks the essentials. */
function normalize(raw: RawCatalogEntry): TargetCatalogEntry | null {
  const tcin = Number(raw?.tcin);
  if (!Number.isFinite(tcin) || !raw?.url) return null;
  return {
    tcin,
    url: raw.url,
    name: deriveNameFromUrl(raw.url),
    price: parsePrice(raw.price),
    stock: raw.stock ?? null,
    releaseDate: raw.release_date ?? null,
  };
}

/**
 * Load + normalize the newest catalog file. Cached in-process (keyed by which
 * file is newest, so dropping a new file busts the cache on the next boot).
 * Never throws — a missing/corrupt file yields an empty list, so the app
 * degrades gracefully exactly like an empty catalog.
 */
export function loadTargetCatalog(): TargetCatalogEntry[] {
  const file = newestCatalogFile();
  if (!file) return [];
  if (cached && cachedFile === file) return cached;

  try {
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as RawCatalogEntry[];
    const seen = new Set<number>();
    const list: TargetCatalogEntry[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const entry = normalize(row);
      if (!entry || seen.has(entry.tcin)) continue; // dedupe by TCIN
      seen.add(entry.tcin);
      list.push(entry);
    }
    cached = list;
    cachedFile = file;
    return list;
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Name-similarity matching against the curated PRODUCTS list.
// ------------------------------------------------------------------

/** Lowercase, strip punctuation, drop filler words, collapse whitespace. */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/pok[eé]mon|pokemon/g, "") // shared by everything — no signal
    .replace(/trading card game|tcg/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["the", "and", "of", "a", "styles", "may", "vary", "style"]);

function tokens(s: string): string[] {
  return normName(s)
    .split(" ")
    .filter(t => t && !STOP.has(t));
}

/**
 * Jaccard-style token overlap in [0,1], with a light bonus when one name's
 * tokens are fully contained in the other (handles "…Elite Trainer Box" vs
 * "…Elite Trainer Box (Styles May Vary)").
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = Array.from(new Set(tokens(a)));
  const tb = new Set(tokens(b));
  const tbSize = tb.size;
  if (ta.length === 0 || tbSize === 0) return 0;
  const inter = ta.filter(t => tb.has(t)).length;
  const union = ta.length + tbSize - inter;
  const jaccard = inter / union;
  const containment = inter / Math.min(ta.length, tbSize);
  return 0.7 * jaccard + 0.3 * containment;
}

export type CatalogMatch = {
  productId: string;
  tcin: number;
  catalogName: string;
  score: number;
};

/**
 * Tokens that mark a DIFFERENT product than a curated English retail SKU —
 * languages, oversized/novelty formats, and accessories. If a candidate carries
 * one of these and the curated product doesn't, it's rejected outright: a wrong
 * TCIN would point a pinned product's monitor at the wrong Target page, and
 * "…Booster Box" matching "…Jumbo Booster Box Chinese" is exactly that trap.
 */
const DISQUALIFIER_TOKENS = new Set([
  "chinese", "japanese", "korean", "spanish", "french", "german", "italian", "portuguese",
  "jumbo", "oversized", "art", "awards", "case", "sleeve", "sleeves", "binder", "portfolio",
  "playmat", "poster", "pin", "mini", "keychain", "plush", "figure", "sticker", "stickers",
  "mug", "puzzle", "backpack", "blanket", "socks",
]);

/**
 * Match curated products to catalog entries by name. Conservative on purpose:
 *   - EVERY significant token of the curated product must appear in the
 *     candidate (so "Booster Box" can't match an "Elite Trainer Box"),
 *   - the candidate may add at most a couple of extra descriptor tokens, and
 *     NONE of them may be a disqualifier (language/format/accessory),
 *   - the overall similarity must clear `minScore`.
 * The result: near-exact matches pin, everything else is left for the
 * track-on-demand catalog page rather than risking a wrong TCIN.
 */
export function matchCatalogToProducts(
  products: { id: string; name: string; targetTcin?: number }[],
  catalog: TargetCatalogEntry[] = loadTargetCatalog(),
  minScore = 0.75
): CatalogMatch[] {
  const matches: CatalogMatch[] = [];
  for (const product of products) {
    const pTokens = tokens(product.name);
    if (pTokens.length === 0) continue;
    const pSet = new Set(pTokens);

    let best: CatalogMatch | null = null;
    for (const entry of catalog) {
      const cTokens = Array.from(new Set(tokens(entry.name)));
      const cSet = new Set(cTokens);
      // 1) every curated token present in the candidate
      if (!pTokens.every(t => cSet.has(t))) continue;
      // 2) extra tokens the candidate adds — capped, and none disqualifying
      const extra = cTokens.filter(t => !pSet.has(t));
      if (extra.length > 2) continue;
      if (extra.some(t => DISQUALIFIER_TOKENS.has(t))) continue;
      // 3) overall similarity gate
      const score = nameSimilarity(product.name, entry.name);
      if (score < minScore) continue;
      if (!best || score > best.score) {
        best = { productId: product.id, tcin: entry.tcin, catalogName: entry.name, score };
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}
