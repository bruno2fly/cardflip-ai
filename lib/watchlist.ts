import { CDN_IMG, fetchTcgMarketPrice, verifyCandidate } from "@/lib/discovery";
import type { SealedProduct } from "@/lib/products";
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

type AddResult = { ok: true; item: WatchlistItem } | { ok: false; reason: string };

async function insertWatchlistItem(item: {
  tcgProductId: number;
  productName: string;
  productType: string | null;
  msrp: number | null;
  marketPrice: number;
  imageUrl: string | null;
  targetTcin?: number | null;
}): Promise<AddResult> {
  if (!supabase) return { ok: false, reason: "Supabase is not configured." };

  const { data, error } = await supabase
    .from("watchlist")
    .insert({
      tcg_product_id: item.tcgProductId,
      product_name: item.productName,
      product_type: item.productType,
      msrp: item.msrp,
      market_price: item.marketPrice,
      image_url: item.imageUrl,
      target_tcin: item.targetTcin ?? null,
    })
    .select("id, tcg_product_id, product_name, product_type, msrp, market_price, image_url, target_tcin, added_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { ok: false, reason: `${item.productName} is already on your watchlist.` };
    return { ok: false, reason: error?.message ?? "Could not save this product to the watchlist." };
  }
  return { ok: true, item: fromRow(data as WatchlistRow) };
}

export async function addToWatchlist(
  query: string
): Promise<AddResult> {
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

  return insertWatchlistItem({
    tcgProductId: verified.tcgProductId,
    productName: verified.verifiedName,
    productType: verified.productType,
    msrp: verified.msrp,
    marketPrice: verified.market,
    imageUrl: CDN_IMG(verified.tcgProductId),
  });
}

export async function addCuratedProductToWatchlist(product: SealedProduct): Promise<AddResult> {
  if (typeof window !== "undefined") {
    try {
      // Send the fields the server actually needs to add this item, rather
      // than just the id. Curated products live in a static array the server
      // can look up by id, but auto-discovered products (id like `disc-123`)
      // never appear in that array -- looking them up by id alone 404'd with
      // "Curated product not found", even though the watchlist insert logic
      // fully supports them via tcgProductId. Sending the payload directly
      // works for both sources.
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: {
            id: product.id,
            name: product.name,
            type: product.type,
            msrp: product.msrp,
            imageUrl: product.imageUrl,
            tcgProductId: product.tcgProductId ?? null,
            targetTcin: product.targetTcin ?? null,
          },
        }),
      });
      return await response.json();
    } catch {
      return { ok: false, reason: "Could not reach the watchlist verifier." };
    }
  }

  if (!supabase) return { ok: false, reason: "Supabase is not configured." };

  if (product.tcgProductId) {
    const marketPrice = await fetchTcgMarketPrice(product.tcgProductId);
    if (marketPrice == null) {
      return { ok: false, reason: `Could not fetch a live TCGPlayer market price for ${product.name}.` };
    }
    return insertWatchlistItem({
      tcgProductId: product.tcgProductId,
      productName: product.name,
      productType: product.type,
      msrp: product.msrp,
      marketPrice,
      imageUrl: product.imageUrl,
      targetTcin: product.targetTcin,
    });
  }

  const verified = await verifyCandidate({
    name: product.name,
    source: "tcgplayer-trending",
    signal: "curated product watchlist add",
  });
  if (!verified) {
    return { ok: false, reason: `Couldn't verify '${product.name}' as a real Pokémon TCG product.` };
  }
  return insertWatchlistItem({
    tcgProductId: verified.tcgProductId,
    productName: verified.verifiedName,
    productType: verified.productType,
    msrp: product.msrp,
    marketPrice: verified.market,
    imageUrl: CDN_IMG(verified.tcgProductId),
    targetTcin: product.targetTcin,
  });
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
