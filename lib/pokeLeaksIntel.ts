/**
 * Early release intel from r/PokeLeaks — a 204k-member subreddit dedicated to
 * Pokémon leaks, news, and rumours. TCG set reveals frequently surface here
 * days-to-weeks before they hit the official API (or even pokemon.com).
 *
 * Source: https://www.reddit.com/r/PokeLeaks/.rss  (Atom 1.0, NOT RSS 2.0)
 *   - Verified reachable from cloud/datacenter IPs (HTTP 200), unlike
 *     PokeBeach (Cloudflare-walled) and pokemon.com (Incapsula-walled).
 *   - Reddit's .json listing endpoint IS 403-blocked from datacenter IPs, so
 *     the Atom .rss feed is the only usable shape here.
 *
 * FLAIR — important reality check (verified against the live feed, 2026-08):
 * Reddit's post flair ("Confirmed Leak", "Unverified", "Datamine", …) is NOT
 * exposed anywhere in the Atom feed — the per-entry <category> only carries the
 * subreddit ("r/PokeLeaks"), titles are not flair-prefixed, and <content> has
 * no flair marker. So we cannot read flair directly. Instead we derive
 * confidence from title-text signals (corroboration language → "early-intel",
 * everything else → "unverified"), mapping onto the SAME confidence vocabulary
 * lib/intel.ts already uses (official > early-intel > unverified). If Reddit
 * ever starts exposing flair in the feed, prefer it over the heuristic.
 *
 * Built like every other scrape-y source here: descriptive User-Agent (Reddit
 * 429s aggressive anonymous hitters), a single attempt (no retry storm), a
 * 30-min cache, an 8s timeout, and try/catch everywhere → returns [] (or the
 * last good cache) on ANY failure. One flaky source can never take down the
 * /releases page or the intel cron.
 */

import { OFFICIAL_ANNOUNCEMENTS } from "@/lib/officialAnnouncements";

/** Confidence values here are a subset of lib/intel.ts's IntelConfidence. */
export type PokeLeaksConfidence = "early-intel" | "unverified";

export type PokeLeaksIntel = {
  setName: string;
  releaseDate: string | null;   // r/PokeLeaks rarely states a firm date → usually null
  sourceUrl: string;            // permalink to the actual Reddit post
  confidence: PokeLeaksConfidence;
  foundAt: number;
  detail?: string;              // the original post title, for context in the UI
};

const FEED_URL = "https://www.reddit.com/r/PokeLeaks/.rss";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — gentle on Reddit's rate limits
const FETCH_TIMEOUT_MS = 8000;
// Descriptive UA: anonymous default-UA hits to Reddit get 429'd; a real UA
// string with contact intent is the difference between 200 and rate-limit.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CardFlipAI/1.0 (release-intel; +https://cardflip-ai.vercel.app)";

let cache: { items: PokeLeaksIntel[]; at: number } | null = null;

// ---- title text signals -----------------------------------------------------

// Title must look TCG-related (avoids the video-game / anime leaks that also
// fill this subreddit). A known-set alias match ALSO counts as TCG-relevant.
const TCG_SIGNAL = /\b(TCG|booster|elite trainer|ETB|secret rare|trading card|card set|cards?|spoilers?)\b/i;
// Hard video-game/other markers that mean "not a sealed-TCG leak" on their own.
const GAME_ONLY = /\b(gameplay|expansion pass|DLC|betamons|documentary|behind the scenes|soundtrack|amiibo)\b/i;

// Corroboration language → treat as stronger "early-intel"; otherwise unverified.
// (This is our stand-in for the "Confirmed Leak" vs "Unverified" flair the feed
// doesn't expose. A leak defaults to unverified until the title signals more.)
const CONFIRM_SIGNAL = /\b(confirmed|officially|revealed|datamine[d]?|in.?hand|first look|scans?|print(?:ed|s)? confirmed)\b/i;

// Set-name shapes, adapted from lib/leakIntel.ts's Serebii reveal patterns.
const POKEMON = "Pok.{0,2}mon";
const NAME = "([A-Z0-9][A-Za-z0-9'&:\\-]*(?:\\s+[A-Z0-9][A-Za-z0-9'&:.\\-]*){0,4})";
const ANNIVERSARY = /\b(\d{1,3})(?:st|nd|rd|th)\s+(Anniversary|Celebration)\b/i;
const REVEAL_PATTERNS: RegExp[] = [
  new RegExp(`the ${NAME} ${POKEMON} TCG (?:set|expansion)`, "g"),
  new RegExp(`(?:new|upcoming) (?:TCG )?(?:set|expansion),?\\s+${NAME}`, "g"),
  new RegExp(`${NAME} ${POKEMON} TCG (?:set|expansion)`, "g"),
];
// Obvious non-set-name captures the loose patterns can produce.
const NAME_BLOCKLIST = /^(The|This|Their|New|Upcoming|Pokemon|Pok.mon|Secret|Leaks?|More|First|Official)\b/i;

/**
 * Known TCG sets → their canonical name, so a leak that names a set the same
 * way the official/Serebii sources do dedups cleanly in lib/intel.ts. Seeded
 * from the curated official announcements, plus alias spellings leaks use that
 * differ from the official label (e.g. "30th Anniversary" ⇒ "30th Celebration").
 */
function knownSets(): { canonical: string; alias: RegExp }[] {
  const extras = [
    { canonical: "30th Celebration", alias: /\b30th\s+(?:anniversary|celebration)\b/i },
    { canonical: "Mega Evolution: Pitch Black", alias: /\bpitch black\b|\bmega evolution\b/i },
  ];
  const fromOfficial = OFFICIAL_ANNOUNCEMENTS.map(a => ({
    canonical: a.setName,
    alias: new RegExp("\\b" + a.setName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"),
  }));
  return [...extras, ...fromOfficial];
}

function titleCaseOrdinal(s: string): string {
  // "30TH ANNIVERSARY" → "30th Anniversary"
  return s
    .toLowerCase()
    .replace(/\b(\d{1,3})(st|nd|rd|th)\b/g, (_m, n, suf) => `${n}${suf}`)
    .replace(/\b[a-z]/g, c => c.toUpperCase());
}

/** Best-effort set name from a title, or null when nothing set-like is found. */
function extractSetName(title: string): string | null {
  for (const { canonical, alias } of knownSets()) {
    if (alias.test(title)) return canonical;
  }
  const anniv = title.match(ANNIVERSARY);
  if (anniv) return titleCaseOrdinal(`${anniv[1]}th ${anniv[2]}`);

  for (const pattern of REVEAL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(title)) !== null) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (name.length >= 3 && name.length <= 50 && !NAME_BLOCKLIST.test(name)) return name;
    }
  }
  return null;
}

function isTcgRelevant(title: string, knownMatch: boolean): boolean {
  if (GAME_ONLY.test(title) && !knownMatch) return false;
  return knownMatch || TCG_SIGNAL.test(title);
}

// ---- Atom parsing (regex — Reddit's Atom is clean; avoids an XML dep) --------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#0*32;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? m[1].trim() : null;
}

export function parsePokeLeaksFeed(xml: string, foundAt: number): PokeLeaksIntel[] {
  try {
    const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
    const items: PokeLeaksIntel[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      const rawTitle = tag(entry, "title");
      if (!rawTitle) continue;
      const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
      if (!title || /\bmegathread\b/i.test(title)) continue; // pinned mod threads aren't leaks

      const knownMatch = knownSets().some(k => k.alias.test(title));
      if (!isTcgRelevant(title, knownMatch)) continue;

      const setName = extractSetName(title);
      if (!setName) continue; // no parseable set → not actionable intel

      const key = setName.toLowerCase();
      if (seen.has(key)) continue; // collapse the many posts about one set
      seen.add(key);

      const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/i);
      const sourceUrl = linkMatch ? decodeEntities(linkMatch[1]) : "https://www.reddit.com/r/PokeLeaks/";

      items.push({
        setName,
        releaseDate: null, // Reddit posts rarely carry a firm, parseable date
        sourceUrl,
        confidence: CONFIRM_SIGNAL.test(title) ? "early-intel" : "unverified",
        foundAt,
        detail: `r/PokeLeaks: “${title.length > 90 ? `${title.slice(0, 90)}…` : title}”`,
      });
    }
    return items;
  } catch {
    return []; // a parser hiccup can never take the page/cron down
  }
}

/** Fetch + parse the r/PokeLeaks Atom feed. Cached 30 min; [] on any failure. */
export async function getPokeLeaksIntel(force = false): Promise<PokeLeaksIntel[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml, application/xml, text/xml" },
    });
    // 429 / 403 / any non-200 → keep the last good cache rather than clobbering
    // it with nothing, and never throw.
    if (!res.ok) return cache?.items ?? [];
    const xml = await res.text();
    const items = parsePokeLeaksFeed(xml, Date.now());
    cache = { items, at: Date.now() };
    return items;
  } catch {
    return cache?.items ?? []; // rate-limited / network blip: stale beats broken
  } finally {
    clearTimeout(timer);
  }
}
