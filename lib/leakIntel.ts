/**
 * Early release intel scraped from Serebii's news page — set reveals often
 * land here WEEKS before the official Pokemon TCG API mirror lists them.
 *
 * Source: https://www.serebii.net/index2.shtml (their rolling news page;
 * individual articles live at /news/2026/DD-Month-2026.shtml but the index
 * aggregates the recent ones, so one fetch covers it).
 *
 * This is scraping a site with no API. Built accordingly:
 *   - every fetch/parse wrapped in try/catch → returns [] on ANY failure
 *   - regex patterns tolerate Serebii's Latin-1 encoding quirks ("Pok�mon")
 *   - a format change silently yields fewer/zero items, never an exception
 * One broken source must never take down /releases or the cron.
 */

export type LeakIntel = {
  setName: string;
  releaseDate: string | null;  // as printed by Serebii, null when not stated
  source: "serebii";
  sourceUrl: string;
  foundAt: number;
  detail?: string;             // e.g. "Japanese set" when Serebii says so
};

const NEWS_URL = "https://www.serebii.net/index2.shtml";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const FETCH_TIMEOUT_MS = 8000;

let cache: { items: LeakIntel[]; at: number } | null = null;

/** Strip tags/scripts and collapse whitespace so regexes see plain prose. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

// "Pokémon" arrives mangled through Serebii's Latin-1 pages — match loosely.
const POKEMON = "Pok.{0,2}mon";

// A set name: capitalized (or digit-leading, e.g. "30th Celebration") words,
// possibly with & ' - : — bounded to avoid swallowing prose.
const NAME = "([A-Z0-9][A-Za-z0-9'&:\\-]*(?:\\s+[A-Z0-9][A-Za-z0-9'&:\\-]*){0,4})";

const REVEAL_PATTERNS: RegExp[] = [
  // "the next (Japanese) Pokémon TCG set, Storm Emeralda"
  new RegExp(`next (?:Japanese |English )?${POKEMON} TCG set,?\\s+(?:is\\s+)?${NAME}`, "g"),
  // "This set is (called) Storm Emeralda"
  new RegExp(`[Tt]his set is (?:called )?${NAME}`, "g"),
  // "revealed the new set, Storm Emeralda" / "new expansion, X"
  new RegExp(`(?:new|upcoming) (?:set|expansion),?\\s+${NAME}`, "g"),
  // "the Storm Emeralda Pokémon TCG set" (attributive form)
  new RegExp(`the ${NAME} ${POKEMON} TCG (?:set|expansion)`, "g"),
  // "the coming 30th Celebration Pokémon TCG set"
  new RegExp(`(?:coming|upcoming)\\s+${NAME} ${POKEMON} TCG (?:set|expansion)`, "g"),
];

const DATE_PATTERN =
  /(?:releases?|will release|launch(?:es|ing)?|available)(?: worldwide| in the west| globally)?\s+on\s+((?:[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+)(?:,? \d{4})?)/;

// obvious non-set-name captures the loose patterns can produce
const NAME_BLOCKLIST = /^(The|This|Their|Company|Department|Trading Card|TCG|Booster|Elite Trainer)\b/i;

export function parseSerebiiNews(html: string, foundAt: number): LeakIntel[] {
  try {
    const text = toText(html);
    // work per news block so a date is associated with the right set
    const blocks = text.split(/In The (?=(?:Pok.{0,2}mon )?(?:TCG|Games) Department)/);
    const seen = new Set<string>();
    const items: LeakIntel[] = [];

    for (const block of blocks) {
      if (!/TCG/i.test(block)) continue;
      if (/TCG Pocket/i.test(block)) continue; // mobile game sets — not sealed product

      for (const pattern of REVEAL_PATTERNS) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(block)) !== null) {
          const name = m[1].trim().replace(/\s+/g, " ");
          if (name.length < 3 || name.length > 50 || NAME_BLOCKLIST.test(name)) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          const dateMatch = block.match(DATE_PATTERN);
          items.push({
            setName: name,
            releaseDate: dateMatch ? dateMatch[1] : null,
            source: "serebii",
            sourceUrl: NEWS_URL,
            foundAt,
            detail: /Japanese/i.test(block) ? "Japanese set — English equivalent usually follows ~3 months later" : undefined,
          });
        }
      }
    }
    return items;
  } catch {
    return []; // parser can never take the page down
  }
}

/** Fetch + parse Serebii's news page. Cached 30 min; [] on any failure. */
export async function getLeakIntel(force = false): Promise<LeakIntel[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NEWS_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CardFlipAI/1.0" },
    });
    if (!res.ok) return cache?.items ?? [];
    const html = await res.text();
    const items = parseSerebiiNews(html, Date.now());
    cache = { items, at: Date.now() };
    return items;
  } catch {
    return cache?.items ?? []; // stale beats broken; [] beats stale-less
  } finally {
    clearTimeout(timer);
  }
}
