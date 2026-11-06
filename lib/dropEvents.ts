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

/**
 * What KIND of drop this is — the radar shows this as a badge because the
 * play is completely different per type (bot it vs queue up vs enter a
 * drawing vs just be awake).
 */
export type DropType =
  | "street-date"      // official release day — product loads overnight before
  | "overnight-restock"// Target's recurring ~3 AM ET restock burst
  | "drawing"          // raffle entry (Walmart Collectibles Draw style)
  | "invite"           // invitation-gated sale (Best Buy style)
  | "queue"            // virtual queue launch (Pokémon Center style);

// A product referenced by an event that ISN'T in the Target catalog (no TCIN
// to resolve/track) — e.g. a Walmart-only drawing/raffle item. Shown as plain
// info with a direct link, no "Track" button (there's nothing to watchlist
// against, since our stock cron only checks Target TCINs / Walmart item IDs).
export type ExternalDropProduct = {
  name: string;
  price: number | null;
  url?: string;   // direct product/drawing-entry link if known
};

export type DropEvent = {
  id: string;
  title: string;          // "30th Celebration — Target retail drop"
  retailer: string;       // "Target"
  type: DropType;         // how this drop plays (see DropType)
  dropsAt: string;        // ISO datetime the drop is expected to go live
  window?: string;        // short human hint, e.g. "Street date · watch overnight loads"
  confidence: DropConfidence;
  note: string;           // what's happening / how to play it
  sourceUrl?: string;     // where the intel came from
  tcins: number[];        // the products to get ready for (Target catalog, trackable)
  externalProducts?: ExternalDropProduct[]; // non-Target products, info-only (see type above)
  graceHours?: number;    // keep showing this long after dropsAt (default 24)
};

export const DROP_EVENTS: DropEvent[] = [
  {
    id: "target-friday-overnight-restock",
    title: "Target overnight restock burst",
    retailer: "Target",
    type: "overnight-restock",
    // Target's recurring pattern: Friday overnights, roughly 2:45–6:30 AM ET
    // (tracked live by RestockR/Restockd on Oct 23, Oct 28, Nov 4 and Nov 6).
    // This event is dated to the NEXT Friday and refreshed when it passes —
    // the pattern itself is weekly, not one-off.
    dropsAt: "2026-11-13T02:45:00-05:00",
    window: "Friday 2:45–6:30 AM ET · fast-poll window already scheduled",
    confidence: "expected",
    note:
      "Target's recurring Pokémon restock burst — most Friday overnights around 3 AM ET, staggered per item, gone in ~90 seconds. The DropBot's fast-poll window is scheduled for these hours automatically; arm the products you want and sleep through it.",
    sourceUrl: "https://www.restockr.app/pokemon-restocks/target",
    tcins: [], // whatever is armed on the bot watchlist at the time
  },
  {
    id: "delta-reign-bestbuy-invite",
    title: "Delta Reign Booster Box — Best Buy invite",
    retailer: "Best Buy",
    type: "invite",
    // Best Buy opened Delta Reign Booster Box invites at $160.99 (Nov 4,
    // ptcg.news) — invitation-gated, account required, entry while open.
    dropsAt: "2026-11-10T12:00:00-05:00",
    window: "Invites open now — closes when allocated",
    confidence: "confirmed",
    note:
      "Best Buy is selling the Delta Reign Booster Box at $160.99 through its invitation system — not a race the bot can win, an entry you have to make on a warmed-up Best Buy account. Enter while the invite is open; stock is allocated to invited accounts only.",
    sourceUrl: "https://www.bestbuy.com/",
    tcins: [],
    externalProducts: [
      { name: "Delta Reign Booster Box (Best Buy invite, $160.99)", price: 160.99, url: "https://www.bestbuy.com/" },
    ],
  },
  {
    id: "mega-greninja-league-deck-nov13",
    title: "Mega Greninja ex League Battle Deck",
    retailer: "Target / Pokémon Center",
    type: "street-date",
    // Nov 13 street date per Pokémon's November lineup (ptcg.news round-up).
    dropsAt: "2026-11-13T00:00:00-05:00",
    window: "Street date Friday — watch overnight loads Thursday into Friday",
    confidence: "confirmed",
    note:
      "Mega Greninja ex League Battle Deck lands Nov 13. Retail loads overnight before street date — Target TCIN gets pinned to the bot as soon as the listing resolves; Pokémon Center runs a queue launch the same day.",
    sourceUrl: "https://ptcg.news/news/",
    tcins: [],
  },
  {
    id: "30th-celebration-final-wave-dec4",
    title: "30th Celebration final wave — Binder Collection + ex Tins",
    retailer: "Target",
    type: "street-date",
    // Dec 4 street date for the final 30th Celebration wave (cardrake.com
    // wave table). Binder Collection + Pokémon ex Tins. The TCINs below are
    // already listed on Target (pre-listed, OOS) and on the bot watchlist.
    dropsAt: "2026-12-04T00:00:00-05:00",
    window: "Street date Friday — overnight load Thursday into Friday",
    confidence: "confirmed",
    note:
      "The final 30th Celebration wave: Binder Collection ($44.99) and the Pokémon ex Tins ($29.99). Both TCINs are already listed and armed on the bot — this is the big one to have the fast-poll window scheduled for.",
    sourceUrl: "https://www.cardrake.com/expansions/cel30",
    tcins: [
      1010892074, // Binder Collection — $44.99
      1010892069, // Pokémon ex Tin (Sylveon or Greninja) — $29.99
    ],
  },
  {
    id: "upc-restock-watch",
    title: "30th Celebration Ultra Premium Collections — restock watch",
    retailer: "Target / Best Buy / Pokémon Center",
    type: "overnight-restock",
    // Nov 6 street date passed; UPCs are the hottest 30th Celebration item
    // and restock in bursts. Target $249.99 (marked up from $179.99 MSRP),
    // Best Buy $179.99 invite-gated, Pokémon Center queue.
    dropsAt: "2026-11-07T02:45:00-05:00",
    window: "Restock bursts — Friday overnights + staggered daytime flickers",
    confidence: "expected",
    note:
      "The Day/Night UPCs sold out on street date and restock in short bursts. Target lists them at $249.99 (above the $179.99 MSRP — currently NOT armed on the bot for that reason); Best Buy sells at $179.99 but invite-gates the sale; Pokémon Center runs a queue. Day/Night TCINs: 1012850570 / 1012850572.",
    sourceUrl: "https://www.ign.com/articles/where-to-buy-pokemon-tcg-30th-celebration-ultra-premium-collection",
    tcins: [],
    externalProducts: [
      { name: "UPC Day — Target $249.99 (marked up, not armed)", price: 249.99, url: "https://www.target.com/p/A-1012850570" },
      { name: "UPC Day/Night — Best Buy $179.99 (invite-gated)", price: 179.99, url: "https://www.bestbuy.com/" },
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
