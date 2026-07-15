/**
 * Officially announced sets from pokemon.com — CURATED, not scraped.
 *
 * Why curated: pokemon.com (both www and tcg subdomains) sits behind
 * Imperva Incapsula bot protection — datacenter/serverless IPs get a JS
 * challenge, never content (verified live 2026-07-15, same failure class
 * as Target RedSky and PokeBeach's Cloudflare). A runtime scraper would
 * silently return nothing forever, so instead this file holds what
 * pokemon.com has officially announced. It changes a handful of times a
 * year; append a new entry when a set is announced.
 *
 * These are OFFICIAL (pokemon.com is the primary source) — they merge
 * straight into the Confirmed section, ahead of the slow third-party API.
 * New entries added here are picked up by the 6-hour intel cron and
 * emailed once, same dedup as Serebii finds.
 */

export type OfficialAnnouncement = {
  setName: string;
  releaseDateIso: string;   // YYYY-MM-DD — used for day-bucket grouping
  releaseDate: string;      // human-readable, as announced
  sourceUrl: string;        // the pokemon.com page that announced it
  detail?: string;
};

export const OFFICIAL_ANNOUNCEMENTS: OfficialAnnouncement[] = [
  {
    setName: "Mega Evolution: Pitch Black",
    releaseDateIso: "2026-07-17",
    releaseDate: "July 17, 2026",
    sourceUrl: "https://tcg.pokemon.com/en-us/expansions/",
    detail: "Confirmed on pokemon.com",
  },
  {
    setName: "30th Celebration",
    releaseDateIso: "2026-09-16",
    releaseDate: "September 16, 2026",
    sourceUrl: "https://tcg.pokemon.com/en-us/expansions/",
    detail: "Confirmed on pokemon.com — ETBs, Mini Tins, Premium Collections wave",
  },
];
