/**
 * Real price-momentum trend, computed from the price_history log
 * (supabase/price_history.sql) that lib/sealedPricing.ts appends to on every
 * genuine market-price refresh.
 *
 * This REPLACES the old hand-typed hotness strings ("🔥 Hot") as the source of
 * a product's momentum tag. Given a product's last 14 days of real fetched
 * prices we compute:
 *   - percentChange: (newest − oldest) / oldest, as a percent
 *   - direction:     RISING (> +8%), FALLING (< −8%), else STABLE
 *   - dataPoints:    how many rows are in the window, so the UI can say
 *                    "not enough data yet" honestly instead of faking confidence
 *
 * With fewer than 3 data points we refuse to compute a trend (sufficient=false,
 * direction/percentChange null) — a 1–2 point "trend" is noise, not signal.
 *
 * Fully fail-soft, like the rest of the codebase: no Supabase client, an empty
 * table, or a query error all degrade to an insufficient-data trend rather than
 * throwing or crashing the page.
 */

import { supabase } from "@/lib/supabase";

export type TrendDirection = "RISING" | "FALLING" | "STABLE";

export type PriceTrend = {
  productId: string;
  dataPoints: number;              // rows in the window
  sufficient: boolean;             // dataPoints >= MIN_POINTS
  direction: TrendDirection | null; // null when insufficient
  percentChange: number | null;    // percent (e.g. +23.4); null when insufficient
  windowDays: number;
  oldestPrice: number | null;
  newestPrice: number | null;
};

const WINDOW_DAYS = 14;
const MIN_POINTS = 3;             // never compute a trend off 1–2 points
const RISING_THRESHOLD = 8;       // percent; > +8% RISING, < −8% FALLING, else STABLE

type PricePoint = { price: number; checked_at: string };

/** An honest "we don't have enough history" trend for a product. */
function insufficientTrend(productId: string, dataPoints = 0, newestPrice: number | null = null, oldestPrice: number | null = null): PriceTrend {
  return {
    productId,
    dataPoints,
    sufficient: false,
    direction: null,
    percentChange: null,
    windowDays: WINDOW_DAYS,
    oldestPrice,
    newestPrice,
  };
}

/** Compute a trend from a product's raw price rows (any order). Pure — no I/O. */
export function computeTrend(productId: string, rows: PricePoint[]): PriceTrend {
  const points = rows
    .filter(r => typeof r.price === "number" && !Number.isNaN(r.price) && r.price > 0 && r.checked_at)
    .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());

  if (points.length < MIN_POINTS) {
    const newest = points.length ? points[points.length - 1].price : null;
    const oldest = points.length ? points[0].price : null;
    return insufficientTrend(productId, points.length, newest, oldest);
  }

  const oldestPrice = points[0].price;
  const newestPrice = points[points.length - 1].price;
  // oldestPrice is guaranteed > 0 by the filter above, so this never divides by 0
  const percentChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
  const direction: TrendDirection =
    percentChange > RISING_THRESHOLD ? "RISING"
    : percentChange < -RISING_THRESHOLD ? "FALLING"
    : "STABLE";

  return {
    productId,
    dataPoints: points.length,
    sufficient: true,
    direction,
    percentChange,
    windowDays: WINDOW_DAYS,
    oldestPrice,
    newestPrice,
  };
}

function windowCutoffIso(): string {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Trends for many products at once (one query). Pass a list of product ids to
 * restrict, or omit to compute for every product with recent history. Missing
 * products (no rows) come back as an insufficient-data trend so callers can
 * always look one up by id.
 */
export async function getPriceTrends(productIds?: string[]): Promise<Record<string, PriceTrend>> {
  const out: Record<string, PriceTrend> = {};
  // seed requested ids with insufficient so the map is always complete
  for (const id of productIds ?? []) out[id] = insufficientTrend(id);

  if (!supabase) return out;

  try {
    let query = supabase
      .from("price_history")
      .select("product_id, price, checked_at")
      .gte("checked_at", windowCutoffIso());
    if (productIds && productIds.length > 0) query = query.in("product_id", productIds);

    const { data, error } = await query;
    if (error || !data) return out;

    const byProduct = new Map<string, PricePoint[]>();
    for (const row of data as { product_id: string; price: number | string; checked_at: string }[]) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push({ price: Number(row.price), checked_at: row.checked_at });
      byProduct.set(row.product_id, list);
    }
    byProduct.forEach((rows, productId) => { out[productId] = computeTrend(productId, rows); });
    return out;
  } catch {
    return out; // fail-soft: insufficient-data everywhere beats crashing
  }
}

/** Single-product trend. Always resolves — insufficient-data on any failure. */
export async function getPriceTrend(productId: string): Promise<PriceTrend> {
  const trends = await getPriceTrends([productId]);
  return trends[productId] ?? insufficientTrend(productId);
}
