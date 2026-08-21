"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Sparkles } from "lucide-react";

type Restock = {
  rawName: string;
  retailer: string;
  status: "in-stock" | "preorder";
  price: number | null;
  buyUrl: string;
  lastSeenInStock: string | null;
  matchedProductId: string | null;
};

type DropWindow = {
  pattern: {
    retailer: string;
    eventType: "new-product-drop" | "restock-existing" | "general";
    window: string;
    peakDay?: string;
    confidence: "high" | "medium" | "low";
    note: string;
    source: string;
  };
  nextOccurrence: string;
  hoursAway: number;
};

type CommunitySignal = { headline: string; ageText: string; body: string };

const EVENT_LABEL: Record<DropWindow["pattern"]["eventType"], string> = {
  "new-product-drop": "New Product Drops",
  "restock-existing": "Existing Product Restocks",
  general: "General Drops",
};

const RETAILER_ICON: Record<string, string> = { Target: "🎯", Walmart: "🛒" };
const CONFIDENCE_CLASS: Record<DropWindow["pattern"]["confidence"], string> = {
  high: "bg-green-950/60 border-green-700/40 text-green-400",
  medium: "bg-yellow-950/60 border-yellow-700/40 text-yellow-400",
  low: "bg-gray-800 border-gray-700 text-gray-400",
};

function timeUntil(hoursAway: number): string {
  const totalMinutes = Math.max(0, Math.round(hoursAway * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours ? `${hours}h ` : ""}${minutes}m`;
}

export default function RestocksPage() {
  const [listings, setListings] = useState<Restock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [windows, setWindows] = useState<DropWindow[]>([]);
  const [signals, setSignals] = useState<CommunitySignal[]>([]);
  const [intelError, setIntelError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [restocksResult, predictionsResult] = await Promise.allSettled([
      fetch("/api/restocks", { cache: "no-store" }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Restock feed failed");
        return body;
      }),
      fetch("/api/predicted-drops", { cache: "no-store" }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Predictive intel failed");
        return body;
      }),
    ]);

    if (restocksResult.status === "fulfilled") {
        const body = restocksResult.value;
        setListings(body.listings ?? []);
        setUpdatedAt(body.generatedAt ?? new Date().toISOString());
        setError(null);
    } else {
      setError(restocksResult.reason instanceof Error ? restocksResult.reason.message : "Restock feed failed");
    }

    if (predictionsResult.status === "fulfilled") {
      const body = predictionsResult.value;
      setWindows(body.patterns ?? []);
      setSignals(body.liveSignals ?? []);
      setIntelError(null);
    } else {
      setIntelError(predictionsResult.reason instanceof Error ? predictionsResult.reason.message : "Predictive intel failed");
    }
    setLoading(false);
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

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Sparkles size={18} className="text-purple-400" /> 🔮 Predicted Next Drops</h2>
          <p className="text-gray-500 text-xs mt-1">Likely watch windows and community-reported signals — directional intel, never a guaranteed drop.</p>
        </div>

        {intelError && <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-sm rounded-lg px-4 py-3">{intelError}</div>}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-yellow-300">Watch windows</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {windows.map(({ pattern, nextOccurrence, hoursAway }) => (
              <div key={`${pattern.retailer}-${pattern.eventType}`} className="bg-gray-900 border border-yellow-700/40 rounded-xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-semibold">{RETAILER_ICON[pattern.retailer] ?? "🏪"} {pattern.retailer}</span>
                  <span className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CONFIDENCE_CLASS[pattern.confidence]}`}>{pattern.confidence} confidence</span>
                </div>
                <div className="text-yellow-300 text-xs font-semibold mt-2">{EVENT_LABEL[pattern.eventType]} · {pattern.window}</div>
                <div className="text-gray-400 text-xs mt-1">Next likely window: {new Date(nextOccurrence).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · in {timeUntil(hoursAway)}</div>
                {pattern.peakDay && <div className="text-gray-500 text-[11px] mt-1">Peak day: {pattern.peakDay}</div>}
                <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">{pattern.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-purple-300">Community intel</h3>
            <span className="bg-purple-950/60 border border-purple-700/40 text-purple-400 text-[10px] font-medium px-2 py-0.5 rounded-full">community-reported · unverified</span>
          </div>
          {signals.length === 0 && !loading && !intelError && <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400">No forward-looking community signals matched right now.</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {signals.map((signal, index) => (
              <div key={`${signal.headline}-${signal.ageText}-${index}`} className="bg-gray-900 border border-purple-700/50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-white font-semibold text-sm leading-tight">{signal.headline}</h4>
                  <span className="text-gray-500 text-[10px] whitespace-nowrap">{signal.ageText}</span>
                </div>
                {signal.body && <p className="text-gray-400 text-xs mt-2 leading-relaxed">{signal.body}</p>}
                <a href="https://www.typa.app/brands/pokemon" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 bg-purple-950/40 border border-purple-700/40 text-purple-400 hover:text-white text-[10px] font-semibold px-2 py-1 rounded-full mt-3 transition-colors">
                  <ExternalLink size={9} /> via TYPA community
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-gray-800 pt-6">
        <h2 className="text-lg font-bold text-white">🔴 In Stock Right Now</h2>
        <p className="text-gray-500 text-xs mt-1">Live, reactive availability reported by NowInStock.net.</p>
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
