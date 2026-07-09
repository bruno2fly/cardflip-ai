"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { RefreshCw, Target, ExternalLink, Info, Radar, Clock } from "lucide-react";

const FEE_RATE = 0.13;       // 13% marketplace fees
const SHIPPING_COST = 5;     // shipping to buyer
const PACKAGING_COST = 2;    // packaging supplies
const FLAT_COSTS = SHIPPING_COST + PACKAGING_COST;
const MAX_BUY_RATIO = 0.70;  // Max Buy Price = Average Sell Price × 0.70
const DEFAULT_BUDGET = 100;  // beginner-friendly default

type Velocity = { label: string; cls: string };
function velocityFor(market: number): Velocity {
  if (market < 75) return { label: "Sells fast (2–5 days)", cls: "bg-green-950/60 border-green-700/40 text-green-400" };
  if (market <= 300) return { label: "Moderate (1–2 weeks)", cls: "bg-yellow-950/60 border-yellow-700/40 text-yellow-400" };
  return { label: "Slow move (2–6 weeks)", cls: "bg-orange-950/60 border-orange-700/40 text-orange-400" };
}

type HuntCard = {
  id: string;
  name: string;
  set: string;
  number: string;
  image: string | null;
  market: number;
  url: string | null;
};

type HuntPrice =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; market: number; low: number | null };

type ScanResult = { running: boolean; message: string | null; ok: boolean };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function agoLabel(updatedAt: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000));
  if (mins < 5) return "Updated just now";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function mercariUrl(name: string) {
  return `https://www.mercari.com/search/?keyword=${encodeURIComponent(`${name} pokemon`)}&sortBy=3`;
}
function ebayUrl(name: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${name} pokemon`)}&LH_BIN=1&_sop=15`;
}
function tcgplayerUrl(name: string) {
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(name)}&view=grid&sortMode=2`;
}

export default function HuntList() {
  const [cards, setCards] = useState<HuntCard[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [listError, setListError] = useState(false);
  const [prices, setPrices] = useState<Record<string, HuntPrice>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [scan, setScan] = useState<ScanResult>({ running: false, message: null, ok: true });
  const [budget, setBudget] = useState<number>(DEFAULT_BUDGET);
  const [budgetInput, setBudgetInput] = useState<string>(String(DEFAULT_BUDGET));

  // Budget persists in localStorage
  useEffect(() => {
    const stored = localStorage.getItem("cardflip-budget");
    if (stored && !isNaN(parseFloat(stored))) {
      setBudget(parseFloat(stored));
      setBudgetInput(stored);
    }
  }, []);

  function updateBudget(value: string) {
    setBudgetInput(value);
    const n = parseFloat(value);
    const next = !isNaN(n) && n > 0 ? n : 0;
    setBudget(next);
    if (next > 0) localStorage.setItem("cardflip-budget", String(next));
  }

  // A card is affordable when its Max Buy Price fits the budget
  function marketFor(card: HuntCard): number {
    const p = prices[card.id];
    return p?.status === "ok" ? p.market : card.market;
  }
  const visibleCards = budget > 0
    ? cards.filter(c => marketFor(c) * MAX_BUY_RATIO <= budget)
    : cards;
  const hiddenCount = cards.length - visibleCards.length;

  // Fetch live prices per card from /api/prices
  const fetchPrices = useCallback(async (list: HuntCard[]) => {
    setRefreshing(true);
    setPrices(Object.fromEntries(list.map(c => [c.id, { status: "loading" as const }])));

    await Promise.allSettled(list.map(async (card) => {
      try {
        const params = new URLSearchParams({ name: card.name });
        if (card.set) params.set("set", card.set);
        if (card.number) params.set("number", card.number);
        const res = await fetch(`/api/prices?${params}`);
        const json = await res.json();
        if (!res.ok || json.prices?.market == null) throw new Error();
        setPrices(prev => ({ ...prev, [card.id]: { status: "ok", market: json.prices.market, low: json.prices.low ?? null } }));
      } catch {
        setPrices(prev => ({ ...prev, [card.id]: { status: "error" } }));
      }
    }));
    setRefreshing(false);
  }, []);

  // Load the auto-generated hunt list from /api/hunt
  const loadHuntList = useCallback(async () => {
    setListError(false);
    try {
      const res = await fetch("/api/hunt");
      const json = await res.json();
      if (!res.ok || !json.cards) throw new Error();
      setCards(json.cards);
      setUpdatedAt(json.updatedAt);
      fetchPrices(json.cards);
    } catch {
      setListError(true);
    }
  }, [fetchPrices]);

  useEffect(() => { loadHuntList(); }, [loadHuntList]);

  async function runScanNow() {
    setScan({ running: true, message: null, ok: true });
    try {
      const res = await fetch("/api/cron/scan");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");
      const bits = [
        `Scanned ${json.scanned} cards`,
        `${json.hot} hot`,
        json.emailed
          ? `email sent for ${json.alerted}`
          : json.hot > 0
            ? `no email (${json.emailDetail})`
            : "no email needed",
      ];
      if (json.skippedDuplicates > 0) bits.push(`${json.skippedDuplicates} skipped as duplicates`);
      setScan({ running: false, message: bits.join(" · "), ok: true });
    } catch (err) {
      setScan({ running: false, message: (err as Error).message, ok: false });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Target size={22} className="text-yellow-400" /> Today&apos;s Hunt List
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Cards worth buying right now. Buy at or below the <span className="text-green-400 font-semibold">Max Buy Price</span> to guarantee profit.
          </p>
          {updatedAt && (
            <p className="text-gray-600 text-xs mt-1 flex items-center gap-1">
              <Clock size={11} /> {agoLabel(updatedAt)} · auto-refreshes every 6 hours
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runScanNow}
            disabled={scan.running}
            className="flex items-center gap-2 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
          >
            <Radar size={13} className={scan.running ? "animate-spin" : ""} /> Run Scan Now
          </button>
          <button
            onClick={() => cards.length > 0 && fetchPrices(cards)}
            disabled={refreshing || cards.length === 0}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs font-medium px-4 py-2 rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh Prices
          </button>
        </div>
      </div>

      {/* Scan result */}
      {scan.message && (
        <div className={`text-xs rounded-lg px-4 py-2.5 border ${
          scan.ok
            ? "bg-yellow-950/40 border-yellow-800/40 text-yellow-300"
            : "bg-red-950/40 border-red-800/40 text-red-300"
        }`}>
          {scan.ok ? "Scan complete: " : "Scan failed: "}{scan.message}
        </div>
      )}

      {/* Budget filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <label htmlFor="budget" className="text-white text-sm font-semibold whitespace-nowrap">My Budget</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input
              id="budget"
              type="number" min="0" step="1"
              value={budgetInput}
              onChange={e => updateBudget(e.target.value)}
              className="w-28 bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2 text-sm text-white tabular focus:outline-none focus:border-yellow-400/50"
            />
          </div>
        </div>
        <span className="text-gray-400 text-xs">
          {budget > 0
            ? <>Showing cards you can afford with your <span className="text-green-400 font-semibold">${budget.toLocaleString("en-US")}</span> budget{cards.length > 0 && hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}.</>
            : "Enter a budget to filter the list to cards you can afford."}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-xs text-gray-400">
        <Info size={13} className="text-gray-500 flex-shrink-0" />
        <span>
          <span className="text-green-400 font-semibold">Max Buy Price</span> = the most you should ever pay ·{" "}
          <span className="text-white font-semibold">Est. Profit</span> = what you make after fees &amp; shipping
        </span>
      </div>

      {listError && (
        <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-sm rounded-lg px-4 py-3">
          Couldn&apos;t load the hunt list — the Pokemon TCG API may be down.{" "}
          <button onClick={loadHuntList} className="underline hover:text-white">Try again</button>
        </div>
      )}

      {/* Loading skeleton for the list itself */}
      {!listError && cards.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-16 h-24 rounded-md bg-gray-800" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-gray-800 rounded w-3/4" />
                  <div className="h-3 bg-gray-800 rounded w-1/2" />
                </div>
              </div>
              <div className="h-14 bg-gray-800 rounded-lg mb-3" />
              <div className="h-16 bg-gray-800/60 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* No affordable cards */}
      {cards.length > 0 && visibleCards.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm">
          No cards fit your ${budget.toLocaleString("en-US")} budget right now — try raising it.
        </div>
      )}

      {/* Hunt grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleCards.map((card) => {
          const p = prices[card.id] ?? { status: "loading" as const };
          const ok = p.status === "ok";
          const market = ok ? p.market : card.market; // fall back to hunt-list price
          const usable = ok || p.status === "error" ? ok : false;
          const maxBuy = market * MAX_BUY_RATIO;
          // true profit: sell at market, minus 13% platform fee, $5 shipping, $2 packaging
          const profit = market * (1 - FEE_RATE) - FLAT_COSTS - maxBuy;
          // ROI uses the real market spread: buy at TCG Low (cheapest listed),
          // sell at market, minus 13% fees. Falls back to market × 0.70 when
          // no low price is available.
          const buyAt = ok && p.low != null && p.low > 0 ? p.low : maxBuy;
          const roi = buyAt > 0 ? ((market - buyAt - market * FEE_RATE) / buyAt) * 100 : 0;

          return (
            <div key={card.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 flex flex-col transition-all">
              {/* Image + name */}
              <div className="flex gap-3 mb-3">
                <div className="relative w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                  {card.image ? (
                    <Image src={card.image} alt={card.name} fill className="object-contain" sizes="64px" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-2xl">🃏</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-white text-sm leading-tight">{card.name}</div>
                  <div className="text-gray-500 text-xs mt-1 truncate">{card.set}</div>
                  <div className="text-gray-600 text-[11px]">#{card.number}</div>
                  {card.url && (
                    <a href={card.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-yellow-400 text-[11px] mt-1 transition-colors">
                      <ExternalLink size={9} /> TCGPlayer
                    </a>
                  )}
                </div>
              </div>

              {/* Max Buy Price — THE number */}
              <div className="bg-green-950/40 border border-green-800/40 rounded-lg px-3 py-2.5 mb-3">
                <div className="text-green-500/80 text-[11px] font-medium uppercase tracking-wide">Max Buy Price</div>
                {p.status === "loading" && <div className="h-7 w-24 bg-gray-800 rounded animate-pulse mt-1" />}
                {p.status === "error" && <div className="text-gray-500 text-sm font-semibold mt-0.5">Price unavailable</div>}
                {ok && <div className="text-green-400 text-2xl font-extrabold tabular">${fmt(maxBuy)}</div>}
              </div>

              {/* Numbers */}
              <div className="space-y-1.5 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Average Sell Price</span>
                  {p.status === "loading" ? (
                    <div className="h-3 w-14 bg-gray-800 rounded animate-pulse" />
                  ) : (
                    <span className="text-white tabular font-medium">{usable ? `$${fmt(market)}` : "—"}</span>
                  )}
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Est. Profit (after fees + shipping)</span>
                  {p.status === "loading" ? (
                    <div className="h-3 w-14 bg-gray-800 rounded animate-pulse" />
                  ) : (
                    <span className={`tabular font-medium ${usable && profit > 0 ? "text-green-400" : "text-gray-500"}`}>
                      {usable ? `+$${fmt(profit)}` : "—"}
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ROI</span>
                  {p.status === "loading" ? (
                    <div className="h-3 w-10 bg-gray-800 rounded animate-pulse" />
                  ) : (
                    <span className={`tabular font-medium ${usable && roi > 0 ? "text-green-400" : "text-gray-500"}`}>
                      {usable ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-auto grid grid-cols-2 gap-2">
                <a
                  href={mercariUrl(card.name)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/30 text-pink-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  Find on Mercari
                </a>
                <a
                  href={ebayUrl(card.name)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  Find on eBay
                </a>
                <a
                  href={tcgplayerUrl(card.name)}
                  target="_blank" rel="noopener noreferrer"
                  className="col-span-2 flex items-center justify-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-gray-900 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  Find on TCGPlayer
                </a>
              </div>

              {/* Sell velocity */}
              {(() => {
                const v = velocityFor(market);
                return (
                  <div className="mt-3 flex justify-center">
                    <span
                      title="Estimated time to sell based on card price range"
                      className={`inline-flex items-center gap-1 border text-[11px] font-medium px-2.5 py-1 rounded-full cursor-help ${v.cls}`}
                    >
                      ⏱ {v.label}
                    </span>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
