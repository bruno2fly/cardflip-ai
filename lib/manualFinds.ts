/**
 * Manually curated release/leak intel — Bruno/Jason paste in real finds from
 * Serebii/r/PokeLeaks-adjacent sources that belong in the "Early Intel" section
 * on /releases (confidence "unverified"), NOT time-sensitive retail drops.
 *
 * IMPORTANT: actionable retail drops ("Target loads X tonight at 3AM") now live
 * in lib/dropEvents.ts, which renders the get-ready product board on the Drops
 * page AND auto-expires once the drop passes. Do NOT re-add "tonight"-style drop
 * intel here — it has no expiry and goes stale (that's exactly what happened to
 * the old 30th Anniversary entry, which is why this list is now empty).
 *
 * To add a genuine leak here: append an entry with a real sourceUrl. A `foundAt`
 * timestamp is stamped automatically at request time (see lib/intel.ts).
 */

export type ManualFind = {
  setName: string;
  releaseDate: string | null;
  sourceUrl: string;
  detail: string;
};

export const MANUAL_FINDS: ManualFind[] = [];
