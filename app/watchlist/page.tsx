"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, Loader2, RefreshCw, Search, Star, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addToWatchlist, getWatchlist, removeFromWatchlist, WatchlistItem } from "@/lib/watchlist";

type StockHit = {
  itemId: string;
  rawName: string;
  retailer: string;
  status: "in-stock" | "out-of-stock" | "preorder" | "unknown";
  price: number | null;
  buyUrl: string;
};

type TargetStatus = {
  productId: string;
  status: "in-stock" | "out-of-stock" | "unknown";
  url: string | null;
};

type StatusPayload = {
  prices: Record<string, number | null>;
  nowInStock: StockHit[];
  target: TargetStatus[];
};

function money(value: number | null) {
  return value == null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const statusStyle = {
  "in-stock": "bg-green-950/60 border-green-700/40 text-green-400",
  preorder: "bg-blue-950/60 border-blue-700/40 text-blue-400",
  "out-of-stock": "bg-red-950/40 border-red-800/40 text-red-400",
  unknown: "bg-gray-800 border-gray-700 text-gray-400",
} as const;

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload>({ prices: {}, nowInStock: [], target: [] });

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/watchlist/status", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Live status refresh failed");
      setStatus(body as StatusPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live status refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await getWatchlist();
    setItems(next);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) void refreshStatus(); }, [loading, refreshStatus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim() || adding) return;
    setAdding(true);
    setError(null);
    const result = await addToWatchlist(query);
    if (result.ok) {
      setItems(current => [result.item, ...current]);
      setQuery("");
      await refreshStatus();
    } else {
      setError(result.reason);
    }
    setAdding(false);
  }

  async function remove(id: string) {
    setRemovingId(id);
    setError(null);
    if (await removeFromWatchlist(id)) {
      setItems(current => current.filter(item => item.id !== id));
      setStatus(current => ({
        prices: Object.fromEntries(Object.entries(current.prices).filter(([key]) => key !== id)),
        nowInStock: current.nowInStock.filter(hit => hit.itemId !== id),
        target: current.target.filter(hit => hit.productId !== id),
      }));
    } else {
      setError("Could not remove that watchlist item.");
    }
    setRemovingId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Watchlist</h1>
          <p className="text-gray-500 text-sm mt-0.5">Verified products watched by the same live restock alert engine</p>
        </div>
        <button
          onClick={refreshStatus}
          disabled={refreshing || loading}
          className="flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh Live Data
        </button>
      </div>

      {!supabase && (
        <div className="bg-orange-950/40 border border-orange-800/40 text-orange-300 text-xs rounded-lg px-4 py-2.5">
          Supabase is not configured — run supabase/watchlist.sql and set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </div>
      )}

      <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5">
        <label htmlFor="watchlist-query" className="block text-sm font-semibold text-white mb-2">Add a sealed product</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              id="watchlist-query"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="e.g. Pitch Black Elite Trainer Box"
              disabled={adding}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400/50 disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !query.trim() || !supabase}
            className="flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-gray-950 text-sm font-bold px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {adding ? <Loader2 size={16} className="animate-spin" /> : <Star size={16} />}
            {adding ? "Verifying…" : "Add to Watchlist"}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-2" role="alert">{error}</p>}
        <p className="text-gray-600 text-xs mt-2">Only products verified by TCGPlayer name match, live market price, and live image can be added.</p>
      </form>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin" /> Loading watchlist…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 px-6 text-center">
          <Star size={30} className="text-gray-700 mx-auto mb-3" />
          <h2 className="text-white font-semibold">Your watchlist is empty</h2>
          <p className="text-gray-500 text-sm mt-1">Add any real Pokémon TCG sealed product above to start monitoring it.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(item => {
            const hits = status.nowInStock.filter(hit => hit.itemId === item.id);
            const target = status.target.find(hit => hit.productId === item.id);
            const buyableHits = hits.filter(hit => hit.status === "in-stock" || hit.status === "preorder");
            const targetBuyable = target?.status === "in-stock" && target.url;
            const buy = buyableHits[0] ?? (targetBuyable ? { buyUrl: target.url as string, retailer: "Target" } : null);
            const liveMarket = status.prices[item.id] ?? item.marketPrice;

            return (
              <article key={item.id} className="relative bg-gray-900 border border-gray-800 rounded-xl p-5">
                <button
                  onClick={() => remove(item.id)}
                  disabled={removingId === item.id}
                  aria-label={`Remove ${item.productName}`}
                  className="absolute right-3 top-3 z-10 text-gray-600 hover:text-red-400 bg-gray-950/80 border border-gray-800 rounded-full p-1.5 transition-colors disabled:opacity-50"
                >
                  {removingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                </button>

                <div className="flex items-start gap-4 pr-7">
                  <div className="relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-800">
                    {item.imageUrl ? <Image src={item.imageUrl} alt={item.productName} fill className="object-contain" sizes="96px" /> : null}
                  </div>
                  <div className="min-w-0">
                    <span className="inline-flex bg-gray-800 border border-gray-700 text-gray-400 text-[10px] font-semibold rounded-full px-2 py-0.5 mb-2">{item.productType ?? "Sealed Product"}</span>
                    <h2 className="text-white text-sm font-semibold leading-snug">{item.productName}</h2>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3">
                    <div className="text-gray-600 text-[10px] uppercase tracking-wide">MSRP</div>
                    <div className="text-gray-300 text-lg font-bold mt-0.5">{money(item.msrp)}</div>
                  </div>
                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3">
                    <div className="text-gray-600 text-[10px] uppercase tracking-wide">Live Market</div>
                    <div className="text-yellow-400 text-lg font-bold mt-0.5">{money(liveMarket)}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {hits.length === 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">NowInStock retailers</span>
                      <span className={`${statusStyle.unknown} border rounded-full px-2 py-0.5`}>No current match</span>
                    </div>
                  )}
                  {hits.map(hit => (
                    <div key={`${hit.retailer}-${hit.buyUrl}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-400 truncate">{hit.retailer}{hit.price ? ` · ${money(hit.price)}` : ""}</span>
                      <span className={`${statusStyle[hit.status]} border rounded-full px-2 py-0.5 whitespace-nowrap`}>{hit.status === "in-stock" ? "In stock" : hit.status === "preorder" ? "Preorder" : "Out of stock"}</span>
                    </div>
                  ))}
                  {item.targetTcin != null && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-400">Target ghost stock</span>
                      <span className={`${statusStyle[target?.status ?? "unknown"]} border rounded-full px-2 py-0.5`}>{target?.status === "in-stock" ? "In stock" : target?.status === "out-of-stock" ? "Out of stock" : "Unknown"}</span>
                    </div>
                  )}
                </div>

                {buy && (
                  <a href={buy.buyUrl} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-400 text-gray-950 text-sm font-bold py-2.5 rounded-lg transition-colors">
                    Buy Now at {buy.retailer} <ExternalLink size={14} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
