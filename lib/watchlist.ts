import { CDN_IMG, fetchTcgMarketPrice, verifyCandidate } from "@/lib/discovery";
import type { SealedProduct } from "@/lib/products";
import { supabase } from "@/lib/supabase";

export type WatchlistItem = {
  id: string;
  // Null for Target-catalog-sourced rows, which have only a Target TCIN and no
  // TCGPlayer product (see addTargetCatalogToWatchlist + the
  // watchlist_target_source migration). TCGPlayer-verified rows always have one.
  tcgProductId: number | null;
  productName: string;
  productType: string | null;
  msrp: number | null;
  marketPrice: number | null;
  imageUrl: string | null;
  targetTcin: number | null;
  source: string; // "tcgplayer" (default) | "target-catalog"
  targetUrl: string | null; // real direct Target product URL, when known
  addedAt: string;
};

type WatchlistRow = {
  id: string;
  tcg_product_id: number | string | null;
  product_name: string;
  product_type: string | null;
  msrp: number | string | null;
  market_price: number | string | null;
  image_url: string | null;
  target_tcin: number | string | null;
  source?: string | null;
  target_url?: string | null;
  added_at: string;
};

// Columns selected on every watchlist read/insert. Centralized so the Target-
// source columns can't be forgotten in one place and present in another.
const WATCHLIST_COLUMNS =
  "id, tcg_product_id, product_name, product_type, msrp, market_price, image_url, target_tcin, source, target_url, added_at";

function nullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromRow(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    tcgProductId: nullableNumber(row.tcg_product_id),
    productName: row.product_name,
    productType: row.product_type,
    msrp: nullableNumber(row.msrp),
    marketPrice: nullableNumber(row.market_price),
    imageUrl: row.image_url,
    targetTcin: nullableNumber(row.target_tcin),
    source: row.source ?? "tcgplayer",
    targetUrl: row.target_url ?? null,
    addedAt: row.added_at,
  };
}

type AddResult = { ok: true; item: WatchlistItem } | { ok: false; reason: string };

async function insertWatchlistItem(item: {
  tcgProductId: number | null;
  productName: string;
  productType: string | null;
  msrp: number | null;
  marketPrice: number | null;
  imageUrl: string | null;
  targetTcin?: number | null;
  source?: string;
  targetUrl?: string | null;
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
      source: item.source ?? "tcgplayer",
      target_url: item.targetUrl ?? null,
    })
    .select(WATCHLIST_COLUMNS)
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

/**
 * Add a Target-catalog product (from the scraped catalog: a TCIN + direct URL,
 * usually with no TCGPlayer counterpart) to the watchlist with the TCIN
 * pre-filled. This reuses the EXISTING stock-check + alert pipeline — the stock
 * cron already reads target_tcin off every watchlist row and checks the direct
 * Target page, then fans out alerts. Nothing parallel is built here.
 *
 * Unlike the TCGPlayer paths, there's no market price to verify, so the row goes
 * in with tcgProductId = null and marketPrice = null (source = "target-catalog").
 */
export async function addTargetCatalogToWatchlist(entry: {
  tcin: number;
  name: string;
  price?: number | null; // catalog price → stored as msrp reference
  url?: string | null;
}): Promise<AddResult> {
  if (typeof window !== "undefined") {
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProduct: entry }),
      });
      return await response.json();
    } catch {
      return { ok: false, reason: "Could not reach the watchlist service." };
    }
  }

  if (!supabase) return { ok: false, reason: "Supabase is not configured." };
  if (!Number.isFinite(entry.tcin)) return { ok: false, reason: "A valid Target TCIN is required." };

  // App-level dedup by TCIN (the DB index on target_tcin is intentionally not
  // unique — see the watchlist_target_source migration — so we guard here).
  const { data: existing } = await supabase
    .from("watchlist")
    .select("id")
    .eq("target_tcin", entry.tcin)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, reason: `${entry.name} is already on your watchlist.` };
  }

  return insertWatchlistItem({
    tcgProductId: null,
    productName: entry.name,
    productType: null,
    msrp: entry.price ?? null,
    marketPrice: null,
    imageUrl: null,
    targetTcin: entry.tcin,
    source: "target-catalog",
    targetUrl: entry.url ?? null,
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
    .select(WATCHLIST_COLUMNS)
    .order("added_at", { ascending: false });
  if (error || !data) return [];
  return (data as WatchlistRow[]).map(fromRow);
}
