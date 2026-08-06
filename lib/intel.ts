/**
 * Unified multi-source release intel.
 *
 * Source status (verified live, 2026-07-15):
 *   pokemon-official — pokemon.com is Incapsula-walled from datacenter IPs,
 *                      so it feeds in via the curated lib/officialAnnouncements.ts
 *                      (primary source → confidence "official")
 *   serebii          — live scrape works (lib/leakIntel.ts) → "early-intel"
 *   pokeleaks        — r/PokeLeaks Atom feed works from cloud IPs
 *                      (lib/pokeLeaksIntel.ts) → "early-intel" / "unverified"
 *                      per-post, derived from title signals (flair isn't in the
 *                      feed; Reddit's .json endpoint is 403-walled)
 *   pokebeach        — NOT WIRED: Cloudflare 403 challenge from cloud IPs,
 *                      verified live. Shipping a fetcher would be dead code
 *                      that returns [] forever. Revisit only if they restore
 *                      their RSS feed or drop the bot wall.
 *
 * Every source runs independently (Promise.allSettled + its own try/catch
 * and timeout inside the fetcher) — one source failing can never take down
 * the others, the page, or the cron.
 */

import { getLeakIntel } from "@/lib/leakIntel";
import { getPokeLeaksIntel } from "@/lib/pokeLeaksIntel";
import { OFFICIAL_ANNOUNCEMENTS } from "@/lib/officialAnnouncements";

export type IntelSource = "serebii" | "pokemon-official" | "pokebeach" | "pokeleaks";
export type IntelConfidence = "official" | "early-intel" | "unverified";

export type IntelItem = {
  setName: string;
  releaseDate: string | null;     // human-readable, as printed by the source
  releaseDateIso: string | null;  // YYYY-MM-DD when the source gives a firm date
  source: IntelSource;
  sourceUrl: string;
  confidence: IntelConfidence;
  foundAt: number;
  detail?: string;
};

type IntelFetcher = () => Promise<IntelItem[]>;

const CONFIDENCE_RANK: Record<IntelConfidence, number> = {
  official: 3,
  "early-intel": 2,
  unverified: 1,
};

async function fromOfficialAnnouncements(): Promise<IntelItem[]> {
  return OFFICIAL_ANNOUNCEMENTS.map(a => ({
    setName: a.setName,
    releaseDate: a.releaseDate,
    releaseDateIso: a.releaseDateIso,
    source: "pokemon-official" as const,
    sourceUrl: a.sourceUrl,
    confidence: "official" as const,
    foundAt: Date.now(),
    detail: a.detail,
  }));
}

async function fromSerebii(force: boolean): Promise<IntelItem[]> {
  const items = await getLeakIntel(force); // already try/catch'd + timed out inside
  return items.map(i => ({
    setName: i.setName,
    releaseDate: i.releaseDate,
    releaseDateIso: null,
    source: "serebii" as const,
    sourceUrl: i.sourceUrl,
    confidence: "early-intel" as const,
    foundAt: i.foundAt,
    detail: i.detail,
  }));
}

async function fromPokeLeaks(force: boolean): Promise<IntelItem[]> {
  const items = await getPokeLeaksIntel(force); // try/catch'd + timed out inside
  return items.map(i => ({
    setName: i.setName,
    releaseDate: i.releaseDate,
    releaseDateIso: null,
    source: "pokeleaks" as const,
    sourceUrl: i.sourceUrl,
    confidence: i.confidence, // per-post: "early-intel" or "unverified"
    foundAt: i.foundAt,
    detail: i.detail,
  }));
}

/**
 * Run a set of intel fetchers with full isolation and merge the results,
 * deduping by normalized set name — highest confidence wins; a duplicate
 * with a date fills in a missing date on the winner.
 * Exported separately so source-failure isolation is directly testable.
 */
export async function collectIntel(fetchers: IntelFetcher[]): Promise<IntelItem[]> {
  const settled = await Promise.allSettled(fetchers.map(f => f()));
  const all = settled.flatMap(r => (r.status === "fulfilled" ? r.value : []));

  const byName = new Map<string, IntelItem>();
  for (const item of all) {
    const key = item.setName.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }
    const winner =
      CONFIDENCE_RANK[item.confidence] > CONFIDENCE_RANK[existing.confidence] ? item : existing;
    const loser = winner === item ? existing : item;
    byName.set(key, {
      ...winner,
      // a lower-confidence source can still contribute a date the winner lacks
      releaseDate: winner.releaseDate ?? loser.releaseDate,
      releaseDateIso: winner.releaseDateIso ?? loser.releaseDateIso,
    });
  }
  return Array.from(byName.values());
}

/** All release intel from every working source, merged and deduped. */
export async function getAllIntel(force = false): Promise<IntelItem[]> {
  return collectIntel([
    fromOfficialAnnouncements,
    () => fromSerebii(force),
    () => fromPokeLeaks(force),
    // pokebeach: intentionally absent — see header comment
  ]);
}
