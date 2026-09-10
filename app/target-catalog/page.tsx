"use client";

/**
 * 📡 Target Catalog — the full scraped Target Pokémon TCG catalog (639 products
 * as of the first import), each with a real direct Target link and TCIN.
 *
 * Jason searches the list and 1-clicks "Track" on anything worth monitoring.
 * Tracking adds the product to his EXISTING watchlist with the TCIN pre-filled
 * (POST /api/watchlist → addTargetCatalogToWatchlist), so it flows through the
 * same stock-check cron and the same alert channels — no parallel pipeline.
 *
 * Products already monitored (pinned on a curated product, or already on the
 * watchlist) show a "Monitored" badge instead of a Track button.
 */

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search, Plus, Check, Loader2, RefreshCw, Radar } from "lucide-react";
import { addTargetCatalogToWatchlist } from "@/lib/watchlist";

type CatalogProduct = {
  tcin: number;
  url: string;
  name: string;
  price: number | null;
  stock: string | null;
  releaseDate: string | null;
};

type CatalogResponse = {
  generatedAt: string;
  count: number;
  curatedTcins: number[];
  trackedTcins: number[];
  products: CatalogProduct[];
};

const RESULT_CAP = 120; // keep the DOM light; searching narrows past this fast

export default function TargetCatalogPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // per-tcin UI state for the Track button
  const [tracked, setTracked] = useState<Set<number>>(new Set());
  const [addingTcin, setAddingTcin] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/target-catalog", { cache: "no-store" });
      const body = (await res.json()) as CatalogResponse;
      if (!res.ok) throw new Error("Catalog feed failed");
      setData(body);
      setTracked(new Set(body.trackedTcins ?? []));
      setError(null);
    } catch {
      setError("Couldn't load the Target catalog.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const curated = useMemo(() => new Set(data?.curatedTcins ?? []), [data]);

  const filtered = useMemo(() => {
    const products = data?.products ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      p => p.name.toLowerCase().includes(q) || String(p.tcin).includes(q)
    );
  }, [data, query]);

  const shown = filtered.slice(0, RESULT_CAP);

  async function track(p: CatalogProduct) {
    if (addingTcin != null) return;
    setAddingTcin(p.tcin);
    setRowError(prev => ({ ...prev, [p.tcin]: "" }));
    const result = await addTargetCatalogToWatchlist({
      tcin: p.tcin,
      name: p.name,
      price: p.price,
      url: p.url,
    });
    if (result.ok || /already on your watchlist/i.test(result.ok ? "" : result.reason)) {
      setTracked(prev => new Set(prev).add(p.tcin));
    } else {
      setRowError(prev => ({ ...prev, [p.tcin]: result.reason }));
    }
    setAddingTcin(null);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Radar size={22} className="text-red-400" /> Target Catalog
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Every Target Pokémon TCG product with a real direct link. Track any of them to monitor stock and get the same alerts.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search 639 products by name or TCIN…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {loading
            ? "Loading catalog…"
            : `${filtered.length} match${filtered.length === 1 ? "" : "es"}${
                filtered.length > RESULT_CAP ? ` · showing first ${RESULT_CAP}` : ""
              }`}
        </span>
        {data && <span>{data.count} products · updated {new Date(data.generatedAt).toLocaleDateString()}</span>}
      </div>

      {error && <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400">No products match “{query}”.</div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
        {shown.map(p => {
          const isCurated = curated.has(p.tcin);
          const isTracked = tracked.has(p.tcin);
          const monitored = isCurated || isTracked;
          const busy = addingTcin === p.tcin;
          const err = rowError[p.tcin];
          return (
            <div key={p.tcin} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-white">{p.name}</h2>
                  {isCurated && (
                    <span className="bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">Curated</span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-400">
                  <span>🎯 Target</span>
                  <span className="text-gray-600">·</span>
                  <span>{p.price == null ? "Price on site" : `$${p.price.toFixed(2)}`}</span>
                  <span className="text-gray-600">·</span>
                  <span className="text-gray-600">TCIN {p.tcin}</span>
                  {p.stock && (
                    <>
                      <span className="text-gray-600">·</span>
                      <span className={p.stock.toLowerCase().includes("in stock") ? "text-green-400" : "text-gray-500"}>
                        {p.stock} <span className="text-gray-600">(at scrape)</span>
                      </span>
                    </>
                  )}
                </div>
                {err && <div className="mt-1.5 text-[11px] text-red-300">{err}</div>}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                >
                  View <ExternalLink size={12} />
                </a>
                {monitored ? (
                  <span className="inline-flex items-center justify-center gap-1.5 bg-green-950/50 border border-green-700/40 text-green-400 text-xs font-semibold px-3 py-2 rounded-lg">
                    <Check size={13} /> {isCurated ? "Monitored" : "Tracking"}
                  </span>
                ) : (
                  <button
                    onClick={() => track(p)}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 text-xs font-bold px-3 py-2 rounded-lg transition-colors"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Track
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-gray-600 text-[11px] leading-relaxed">
        Tracking a product adds it to your watchlist with its Target TCIN pre-filled, so the existing stock monitor checks its
        direct product page and alerts you through the same channels. Stock shown here is the scrape-time snapshot — the live
        monitor verifies real availability.
      </p>
    </div>
  );
}
