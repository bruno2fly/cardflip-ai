/**
 * Manually curated restock/drop intel — Bruno/Jason paste in real finds
 * from Reddit, X, restock-tracker sites, etc. faster than any scraper
 * could react. Renders in the same "Early Intel" section on /releases
 * as Serebii/r/PokeLeaks (via lib/intel.ts), confidence "unverified"
 * since it's community-sourced, not an official pokemon.com confirmation.
 *
 * To add a new manual find: append an entry below with a real sourceUrl.
 * Stale entries should be removed once the drop has passed (a `foundAt`
 * timestamp is stamped automatically at request time, not stored here).
 */

export type ManualFind = {
  setName: string;
  releaseDate: string | null;
  sourceUrl: string;
  detail: string;
};

export const MANUAL_FINDS: ManualFind[] = [
  {
    setName: "30th Anniversary — Target Retail Drop (tonight)",
    releaseDate: null,
    sourceUrl:
      "https://www.reddit.com/r/PokemonDeals/comments/1vnlfbv/target_pok%C3%A9mon_30th_anniversary_drop_tonight_814/",
    detail:
      "Reddit (r/PokemonDeals, r/pokemoncards), PokeFindr (X), and restockd.app all report Target loading 30th Anniversary product for a drop tonight, ~12AM PT / 3AM ET: Elite Trainer Box, Poster Collection, ex Box (Greninja), ex Box (Sylveon), Tech Sticker Collection, Knockout Collection, Celebration Tins. Also watch Pitch Black ETB/Booster Bundle and Prismatic Evolutions SPC on the same overnight wave — restockd.app flagged those loading alongside. Backend-activity based, not a confirmed live restock yet — check direct Target product-page links close to 3AM ET.",
  },
];
