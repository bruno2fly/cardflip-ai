/**
 * Upcoming Pokemon set releases from the Pokemon TCG API, plus
 * getConfirmedReleases() which merges in the curated pokemon.com official
 * announcements — the ONE source of truth for "confirmed upcoming sets",
 * shared by /api/releases (page) and /api/cron/releases (7-day email alerts)
 * so the page and the alerts can never disagree.
 */
import { OFFICIAL_ANNOUNCEMENTS } from "@/lib/officialAnnouncements";

export type ReleaseSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;   // YYYY/MM/DD (API format)
  logoUrl: string | null;
  symbolUrl: string | null;
  daysUntil?: number;    // set on upcoming releases
  daysAgo?: number;      // set on recently released
  announcedVia?: string; // e.g. "pokemon.com" — official source ahead of the API
};

export type Releases = { upcoming: ReleaseSet[]; recent: ReleaseSet[] };

const SETS_API = "https://api.pokemontcg.io/v2/sets";
const HORIZON_DAYS = 120;   // look ahead this far
const RECENT_DAYS = 7;      // "just dropped" window — still relevant for pre-order flips

type RawSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  images?: { logo?: string; symbol?: string };
};

export async function getReleases(): Promise<Releases> {
  const headers: Record<string, string> = {};
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  // Newest-first so future + fresh sets are on page 1 (ascending would return 1999 sets)
  const params = new URLSearchParams({
    orderBy: "-releaseDate",
    pageSize: "50",
    select: "id,name,series,releaseDate,images",
  });
  const res = await fetch(`${SETS_API}?${params}`, {
    headers,
    next: { revalidate: 21600 }, // cache 6 hours
  });
  if (!res.ok) throw new Error(`Pokemon TCG API responded ${res.status}`);
  const json = await res.json();

  const now = Date.now();
  const dayMs = 86_400_000;
  const upcoming: ReleaseSet[] = [];
  const recent: ReleaseSet[] = [];

  for (const s of (json.data ?? []) as RawSet[]) {
    const date = new Date(s.releaseDate).getTime();
    if (isNaN(date)) continue;
    const diffDays = Math.ceil((date - now) / dayMs);

    const base: ReleaseSet = {
      id: s.id,
      name: s.name,
      series: s.series,
      releaseDate: s.releaseDate,
      logoUrl: s.images?.logo ?? null,
      symbolUrl: s.images?.symbol ?? null,
    };

    if (diffDays >= 0 && diffDays <= HORIZON_DAYS) {
      upcoming.push({ ...base, daysUntil: diffDays });
    } else if (diffDays < 0 && diffDays >= -RECENT_DAYS) {
      recent.push({ ...base, daysAgo: Math.abs(diffDays) });
    }
  }

  upcoming.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
  recent.sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0));
  return { upcoming, recent };
}

/**
 * Confirmed releases = official Pokemon TCG API sets MERGED with the curated
 * pokemon.com announcements (which the slow API usually lags behind).
 * Officially-announced entries carry announcedVia: "pokemon.com".
 */
export async function getConfirmedReleases(): Promise<Releases> {
  const { upcoming, recent } = await getReleases();
  const known = new Set([...upcoming, ...recent].map(s => s.name.toLowerCase()));
  const dayMs = 86_400_000;
  const up = [...upcoming];
  const rec = [...recent];

  for (const a of OFFICIAL_ANNOUNCEMENTS) {
    if (known.has(a.setName.toLowerCase())) continue; // API already lists it
    const diffDays = Math.ceil((new Date(a.releaseDateIso).getTime() - Date.now()) / dayMs);
    const entry: ReleaseSet = {
      id: `official-${a.setName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: a.setName,
      series: "Officially Announced",
      releaseDate: a.releaseDateIso.replace(/-/g, "/"),
      logoUrl: null,
      symbolUrl: null,
      announcedVia: "pokemon.com",
    };
    if (diffDays >= 0 && diffDays <= HORIZON_DAYS) {
      up.push({ ...entry, daysUntil: diffDays });
    } else if (diffDays < 0 && diffDays >= -RECENT_DAYS) {
      rec.push({ ...entry, daysAgo: Math.abs(diffDays) });
    }
  }

  up.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
  rec.sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0));
  return { upcoming: up, recent: rec };
}
