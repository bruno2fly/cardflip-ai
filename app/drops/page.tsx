"use client";

/**
 * 🟢 Buy Now — everything verified in stock this second.
 *
 * Focused companion to the Drops page (/restocks): Drops tells you what's coming
 * and helps you get ready; this page is the single list of what you can actually
 * buy right now, so the two never duplicate each other.
 *
 * Reuses existing API routes only (no scraping/stock logic rebuilt):
 *   /api/restocks         → live NowInStock listings (real direct buyUrl)
 *   /api/stock            → Best Buy + Target direct-page stock (verified url or null)
 *   /api/watchlist/status → the user's watchlist items seen in stock right now
 *
 * BUY-LINK SAFETY: a green "Buy Now" button only ever renders when we hold a REAL
 * verified direct product URL. When none exists we show a muted grey "Search
 * {Retailer} manually" link instead — never a fake CTA.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search, ShoppingCart, AlertTriangle } from "lucide-react";
import { PRODUCTS, type SealedProduct } from "@/lib/products";

/* ------------------------------------------------------------------ types */

type NowInStockListing = {
  rawName: string;
  retailer: string;
  status: "in-stock" | "preorder";
  price: number | null;
  buyUrl: string;
  lastSeenInStock: string | null;
  matchedProductId?: string | null;
};

type ProductStock = {
  productId: string;
  status: "in-stock" | "out-of-stock" | "unknown";
  sku: string | null;
  url: string | null;
  price: number | null;
};

type StockResponse = {
  bestbuy?: { configured: boolean; checkedAt: number; statuses: ProductStock[] };
  target?: { configured?: boolean; checkedAt?: number; statuses: ProductStock[] };
};

type BuyNowCard = {
  key: string;
  name: string;
  retailer: string;
  price: number | null;
  msrp: number | null;
  directUrl: string | null;
  sourceLabel: string;
  matched: boolean;
};

/* -------------------------------------------------------------- constants */

const productById = new Map<string, SealedProduct>(PRODUCTS.map(p => [p.id, p]));

const RETAILER_ICON: Record<string, string> = {
  Target: "🎯",
  Walmart: "🛒",
  "Best Buy": "🔵",
  "Pokemon Center": "⚪",
  "Pokémon Center": "⚪",
};

function retailerIcon(retailer: string): string {
  return RETAILER_ICON[retailer] ?? "🏪";
}

/** A clearly-labelled manual SEARCH url (never a fake "direct" product link). */
function manualSearchUrl(retailer: string, query: string): string {
  const q = encodeURIComponent(query);
  const r = retailer.toLowerCase();
  if (r.includes("target")) return `https://www.target.com/s?searchTerm=${q}`;
  if (r.includes("best buy") || r.includes("bestbuy")) return `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`;
  if (r.includes("walmart")) return `https://www.walmart.com/search?q=${q}`;
  if (r.includes("pokemon") || r.includes("pokémon")) return `https://www.pokemoncenter.com/search/${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} ${retailer}`)}`;
}

/* ------------------------------------------------------------------- page */

export default function BuyNowPage() {
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [restocks, setRestocks] = useState<NowInStockListing[]>([]);
  const [stock, setStock] = useState<StockResponse | null>(null);
  const [watchNow, setWatchNow] = useState<NowInStockListing[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch("/api/restocks", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/stock", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/watchlist/status", { cache: "no-store" }).then(r => r.json()),
    ]);
    const errs: string[] = [];
    if (results[0].status === "fulfilled") setRestocks(results[0].value.listings ?? []);
    else errs.push("Live restock feed unavailable");
    if (results[1].status === "fulfilled") setStock(results[1].value ?? null);
    else errs.push("Best Buy / Target stock check unavailable");
    if (results[2].status === "fulfilled") setWatchNow(results[2].value.nowInStock ?? []);
    else errs.push("Watchlist status unavailable");
    setErrors(errs);
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const buyNow: BuyNowCard[] = useMemo(() => {
    const cards: BuyNowCard[] = [];
    const seen = new Set<string>();
    const push = (c: BuyNowCard) => {
      const dedupeKey = (c.directUrl || `${c.name}|${c.retailer}`).toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      cards.push(c);
    };

    restocks
      .filter(l => l.status === "in-stock" && l.buyUrl)
      .forEach((l, i) => {
        const matched = l.matchedProductId ? productById.get(l.matchedProductId) : undefined;
        push({
          key: `restock-${i}`,
          name: l.rawName,
          retailer: l.retailer,
          price: l.price,
          msrp: matched?.msrp ?? null,
          directUrl: l.buyUrl,
          sourceLabel: "Live restock",
          matched: Boolean(l.matchedProductId),
        });
      });

    watchNow
      .filter(l => l.status !== "preorder" && l.buyUrl)
      .forEach((l, i) => {
        const matched = l.matchedProductId ? productById.get(l.matchedProductId) : undefined;
        push({
          key: `watch-${i}`,
          name: l.rawName,
          retailer: l.retailer,
          price: l.price,
          msrp: matched?.msrp ?? null,
          directUrl: l.buyUrl,
          sourceLabel: "⭐ Watchlist",
          matched: true,
        });
      });

    const stockGroups: Array<{ retailer: string; statuses: ProductStock[] }> = [
      { retailer: "Best Buy", statuses: stock?.bestbuy?.statuses ?? [] },
      { retailer: "Target", statuses: stock?.target?.statuses ?? [] },
    ];
    for (const group of stockGroups) {
      group.statuses
        .filter(s => s.status === "in-stock")
        .forEach((s, i) => {
          const product = productById.get(s.productId);
          push({
            key: `${group.retailer}-${s.productId}-${i}`,
            name: product?.name ?? s.productId,
            retailer: group.retailer,
            price: s.price,
            msrp: product?.msrp ?? null,
            directUrl: s.url,
            sourceLabel: `${group.retailer} live check`,
            matched: Boolean(product),
          });
        });
    }

    return cards;
  }, [restocks, watchNow, stock]);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🟢 Buy Now</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Everything verified in stock right now. A green button means a real, ready-to-buy direct link.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {buyNow.length} in stock · {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString()}` : "loading…"}
        </span>
        <span>Auto-refreshes every 60s</span>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-xs rounded-lg px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Some feeds didn&apos;t load: {errors.join(" · ")}. Other sources are still live.</span>
        </div>
      )}

      {buyNow.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
          {loading ? "Checking live stock…" : "Nothing verified in stock right now. Check the Drops page for what's coming next."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {buyNow.map(card => {
            const overMsrp = card.price != null && card.msrp != null && card.price > card.msrp;
            return (
              <div key={card.key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{card.name}</span>
                    {card.matched && (
                      <span className="bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">On your list</span>
                    )}
                    <span className="text-gray-600 text-[10px]">{card.sourceLabel}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-gray-300">{retailerIcon(card.retailer)} {card.retailer}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-300">{card.price == null ? "Price on site" : `$${card.price.toFixed(2)}`}</span>
                    {card.msrp != null && (
                      <>
                        <span className="text-gray-600">·</span>
                        <span className="text-gray-500">MSRP ${card.msrp.toFixed(2)}</span>
                      </>
                    )}
                    {overMsrp && (
                      <span className="bg-red-950/60 border border-red-700/40 text-red-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        ⚠ ${(card.price! - card.msrp!).toFixed(2)} over MSRP
                      </span>
                    )}
                  </div>
                </div>

                {card.directUrl ? (
                  <a
                    href={card.directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                  >
                    <ShoppingCart size={14} /> Buy Now <ExternalLink size={13} />
                  </a>
                ) : (
                  <a
                    href={manualSearchUrl(card.retailer, card.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="No verified direct link — this opens a retailer search so you can confirm it yourself."
                    className="inline-flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 text-xs font-medium px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                  >
                    <Search size={13} /> Search {card.retailer} manually <ExternalLink size={11} />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
