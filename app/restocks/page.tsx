"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

type Restock = {
  rawName: string;
  retailer: string;
  status: "in-stock" | "preorder";
  price: number | null;
  buyUrl: string;
  lastSeenInStock: string | null;
  matchedProductId: string | null;
};

export default function RestocksPage() {
  const [listings, setListings] = useState<Restock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/restocks", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Restock feed failed");
      setListings(body.listings ?? []);
      setUpdatedAt(body.generatedAt ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restock feed failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🔴 Live Restocks</h1>
          <p className="text-gray-500 text-sm mt-0.5">Every Pokémon card restock currently reported by NowInStock.net</p>
        </div>
        <button onClick={refresh} disabled={loading} className="flex items-center justify-center gap-2 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh now
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{listings.length} active listing{listings.length === 1 ? "" : "s"}</span>
        <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Loading live feed…"}</span>
      </div>

      {error && <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}
      {!loading && !error && listings.length === 0 && <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400">No active restocks reported right now.</div>}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="divide-y divide-gray-800">
          {listings.map((listing, index) => (
            <div key={`${listing.retailer}-${listing.rawName}-${index}`} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-white">{listing.rawName}</h2>
                  {listing.matchedProductId && <span className="bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">Matched to your list</span>}
                  {listing.status === "preorder" && <span className="bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">Preorder</span>}
                </div>
                <div className="mt-1 text-xs text-gray-400">{listing.retailer} · {listing.price == null ? "Price on site" : `$${listing.price.toFixed(2)}`}</div>
              </div>
              <a href={listing.buyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors">
                Buy now <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
