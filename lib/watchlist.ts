import { CDN_IMG, verifyCandidate } from "@/lib/discovery";
import { supabase } from "@/lib/supabase";

export type WatchlistItem = {
  id: string;
  tcgProductId: number;
  productName: string;
  productType: string | null;
  msrp: number | null;
  marketPrice: number | null;
  imageUrl: string | null;
  targetTcin: number | null;
  addedAt: string;
};

type WatchlistRow = {
  id: string;
  tcg_product_id: number | string;
  product_name: string;
  product_type: string | null;
  msrp: number | string | null;
  market_price: number | string | null;
  image_url: string | null;
  target_tcin: number | string | null;
  added_at: string;
};

function nullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromRow(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    tcgProductId: Number(row.tcg_product_id),
    productName: row.product_name,
    productType: row.product_type,
    msrp: nullableNumber(row.msrp),
    marketPrice: nullableNumber(row.market_price),
    imageUrl: row.image_url,
    targetTcin: nullableNumber(row.target_tcin),
    addedAt: row.added_at,
  };
}

export async function addToWatchlist(
  query: string
): Promise<{ ok: true; item: WatchlistItem } | { ok: false; reason: string }> {
  const name = query.trim();
  if (!name) return { ok: false, reason: "Enter a Pokémon TCG product name." };
  // Verification stays server-side in the browser so TCGPlayer CORS policy
  // cannot turn a real product into a false rejection. The API calls this
  // same helper on the server, where `window` is absent.
  if (typeof window !== "undefined") {
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: name }),
      });
      return await response.json();
    } catch {
      return { ok: false, reason: "Could not reach the watchlist verifier." };
    }
  }
  if (!supabase) return { ok: false, reason: "Supabase is not configured." };

  const verified = await verifyCandidate({
    name,
    source: "tcgplayer-trending",
    signal: "user watchlist search",
  });
  if (!verified) {
    return {
      ok: false,
      reason: `Couldn't verify '${name}' as a real Pokémon TCG product — try a more specific name.`,
    };
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert({
      tcg_product_id: verified.tcgProductId,
      product_name: verified.verifiedName,
      product_type: verified.productType,
      msrp: verified.msrp,
      market_price: verified.market,
      image_url: CDN_IMG(verified.tcgProductId),
    })
    .select("id, tcg_product_id, product_name, product_type, msrp, market_price, image_url, target_tcin, added_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { ok: false, reason: `${verified.verifiedName} is already on your watchlist.` };
    return { ok: false, reason: error?.message ?? "Could not save this product to the watchlist." };
  }
  return { ok: true, item: fromRow(data as WatchlistRow) };
}

export async function removeFromWatchlist(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("watchlist").delete().eq("id", id);
  return !error;
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("watchlist")
    .select("id, tcg_product_id, product_name, product_type, msrp, market_price, image_url, target_tcin, added_at")
    .order("added_at", { ascending: false });
  if (error || !data) return [];
  return (data as WatchlistRow[]).map(fromRow);
}
