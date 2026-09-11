/**
 * Curated DROP EVENTS — the "get ready to buy" board on the Drops page.
 *
 * Each event ties an upcoming/expected retail drop to the exact products Jason
 * should be ready to grab, by Target TCIN. The Drops page (/restocks) renders a
 * countdown + a card per product with a real direct Target link and a one-click
 * Track (which routes the product into the existing watchlist → stock-cron →
 * alert pipeline, so he gets pinged the moment it flips in stock).
 *
 * Bruno/Jason curate these by hand — faster and more precise than any scraper,
 * and it means the products shown are always the right ones. To add a drop:
 * append an entry with the real `tcins` (look them up on the Target Catalog page
 * or with `npm run import:target-catalog`'s output) and a real `dropsAt`.
 *
 * AUTO-EXPIRY: an event stops showing once `dropsAt` + `graceHours` has passed,
 * so nothing goes stale the way the old hardcoded "tonight" intel did. Nothing
 * to clean up manually — past drops simply fall off.
 */

export type DropConfidence = "confirmed" | "expected" | "rumored";

export type DropEvent = {
  id: string;
  title: string;          // "30th Celebration — Target retail drop"
  retailer: string;       // "Target"
  dropsAt: string;        // ISO datetime the drop is expected to go live
  window?: string;        // short human hint, e.g. "Street date · watch overnight loads"
  confidence: DropConfidence;
  note: string;           // what's happening / how to play it
  sourceUrl?: string;     // where the intel came from
  tcins: number[];        // the products to get ready for
  graceHours?: number;    // keep showing this long after dropsAt (default 24)
};

export const DROP_EVENTS: DropEvent[] = [
  {
    id: "30th-celebration-target",
    title: "30th Celebration — Target retail drop",
    retailer: "Target",
    // Official street date confirmed on pokemon.com (Sept 16, 2026). Retail
    // typically loads overnight before street date — watch the direct links.
    dropsAt: "2026-09-16T00:00:00-04:00",
    window: "Street date — watch for overnight Target loads",
    confidence: "confirmed",
    note:
      "Pokémon TCG 30th Celebration wave lands at Target on its Sept 16 street date. Target usually loads product overnight before the date, so keep the direct links ready and Track the set to get alerted the moment any of these flip in stock.",
    sourceUrl: "https://tcg.pokemon.com/en-us/expansions/",
    tcins: [
      1010892076, // Elite Trainer Box — $69.99
      1010892065, // Greninja ex Box — $29.99
      1010892068, // Sylveon ex Box — $29.99
      1010892069, // Tin (Sylveon or Greninja) — $29.99
      1010892067, // Poster Collection — $19.99
      1010892078, // Tech Sticker Collection — $19.99
      1010892070, // Knock Out Collection — $11.99
    ],
  },
];

/**
 * Active events only — anything whose drop time (plus a grace window) has
 * already passed is filtered out, newest-soonest first. This is what auto-expires
 * old drops with zero manual cleanup.
 */
export function getActiveDropEvents(now: number = Date.now()): DropEvent[] {
  return DROP_EVENTS.filter(e => {
    const drop = new Date(e.dropsAt).getTime();
    if (Number.isNaN(drop)) return true; // undated events always show
    const grace = (e.graceHours ?? 24) * 3_600_000;
    return now <= drop + grace;
  }).sort((a, b) => new Date(a.dropsAt).getTime() - new Date(b.dropsAt).getTime());
}
