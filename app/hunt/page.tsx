"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { velocityFor, dealScore } from "@/lib/hunt";
import { RefreshCw, Target, ExternalLink, Info, Clock, AlertTriangle, Sprout, Lock, ChevronDown, ChevronUp } from "lucide-react";

const FEE_RATE = 0.13;       // 13% marketplace fees
const SHIPPING_COST = 5;     // shipping to buyer
const PACKAGING_COST = 2;    // packaging supplies
const FLAT_COSTS = SHIPPING_COST + PACKAGING_COST;
const MAX_BUY_RATIO = 0.70;  // Max Buy Price = Average Sell Price × 0.70
const DEFAULT_BANKROLL = 500; // used only for the capital-lock warning line

// Price tier filter — matches the 3 tiers /api/hunt fetches (10 cards each)
type Tier = "all" | "cheap" | "mid" | "premium";
const TIER_FILTERS: { key: Tier; label: string; hint: string; inTier: (market: number) => boolean }[] = [
  { key: "cheap", label: "🟢 Cheap", hint: "$25–$80", inTier: m => m <= 80 },
  { key: "mid", label: "🟡 Mid", hint: "$80–$200", inTier: m => m > 80 && m <= 200 },
  { key: "premium", label: "🔴 Premium", hint: "$200–$500", inTier: m => m > 200 },
  { key: "all", label: "All", hint: "", inTier: () => true },
];
const TIER_NAMES: Record<Tier, string> = {
  all: "All cards",
  cheap: "Cheap $25–$80",
  mid: "Mid $80–$200",
  premium: "Premium $200–$500",
};

// Starter Mode limits: cheap, fast flips only
const STARTER_MAX_PRICE = 40;
const STARTER_MIN_ROI = 20;

type HuntCard = {
  id: string;
  name: string;
  set: string;
  number: string;
  image: string | null;
  market: number;
  url: string | null;
};

// Per-card live detail — fetched lazily (expand or Refresh), never on page load
type HuntPrice =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; market: number; low: number | null; high: number | null };

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
// Deep-link pre-filtered to Near Mint so the listing matches the "NM avg"
// price shown on the card (verified: Condition=Near+Mint is retained by
// tcgplayer.com search URLs). Without it, the page lists every condition
// (NM/LP/MP/HP) at very different prices.
function tcgplayerUrl(name: string) {
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(name)}&view=grid&sortMode=2&Condition=Near+Mint`;
}

export default function HuntList() {
  const [cards, setCards] = useState<HuntCard[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [listError, setListError] = useState(false);
  const [prices, setPrices] = useState<Record<string, HuntPrice>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [tier, setTier] = useState<Tier>("all");
  const [bankroll, setBankroll] = useState<number>(DEFAULT_BANKROLL);
  const [starterMode, setStarterMode] = useState(false);

  // Tier filter + Starter Mode persist in localStorage; bankroll (for the
  // capital-lock line) reuses the previously saved budget if one exists.
  useEffect(() => {
    const storedTier = localStorage.getItem("cardflip-tier") as Tier | null;
    if (storedTier && ["all", "cheap", "mid", "premium"].includes(storedTier)) setTier(storedTier);
    const storedBudget = localStorage.getItem("cardflip-budget");
    if (storedBudget && !isNaN(parseFloat(storedBudget))) setBankroll(parseFloat(storedBudget));
    setStarterMode(localStorage.getItem("cardflip-starter-mode") === "1");
  }, []);

  function updateTier(next: Tier) {
    setTier(next);
    localStorage.setItem("cardflip-tier", next);
  }

  function toggleStarterMode() {
    const next = !starterMode;
    setStarterMode(next);
    localStorage.setItem("cardflip-starter-mode", next ? "1" : "0");
    // let the sidebar react without a page reload
    window.dispatchEvent(new Event("cardflip-starter-change"));
  }

  // Fetch live detail for ONE card (used on expand)
  const fetchOne = useCallback(async (card: HuntCard) => {
    setPrices(prev => ({ ...prev, [card.id]: { status: "loading" } }));
    try {
      const params = new URLSearchParams({ name: card.name });
      if (card.set) params.set("set", card.set);
      if (card.number) params.set("number", card.number);
      const res = await fetch(`/api/prices?${params}`);
      const json = await res.json();
      if (!res.ok || json.prices?.market == null) throw new Error();
      setPrices(prev => ({
        ...prev,
        [card.id]: { status: "ok", market: json.prices.market, low: json.prices.low ?? null, high: json.prices.high ?? null },
      }));
    } catch {
      setPrices(prev => ({ ...prev, [card.id]: { status: "error" } }));
    }
  }, []);

  // Optional bulk refresh — only when Jason clicks the button, never on load
  const refreshAllPrices = useCallback(async (list: HuntCard[]) => {
    setRefreshing(true);
    await Promise.allSettled(list.map(c => fetchOne(c)));
    setRefreshing(false);
  }, [fetchOne]);

  function toggleExpand(card: HuntCard) {
    const isOpen = !!expanded[card.id];
    setExpanded(prev => ({ ...prev, [card.id]: !isOpen }));
    const p = prices[card.id];
    if (!isOpen && (!p || p.status === "error")) fetchOne(card);
  }

  // Load the auto-generated hunt list from /api/hunt — cards render
  // immediately from the embedded market price. No 30-call waterfall.
  const loadHuntList = useCallback(async () => {
    setListError(false);
    try {
      const res = await fetch("/api/hunt");
      const json = await res.json();
      if (!res.ok || !json.cards) throw new Error();
      setCards(json.cards);
      setUpdatedAt(json.updatedAt);
    } catch {
      setListError(true);
    }
  }, []);

  useEffect(() => { loadHuntList(); }, [loadHuntList]);

  // --- per-card math, shared by rendering and filtering ---
  function statsFor(card: HuntCard) {
    const p = prices[card.id];
    const live = p?.status === "ok" ? p : null;
    const market = live ? live.market : card.market; // hunt-list price until refreshed
    const maxBuy = market * MAX_BUY_RATIO;
    // true profit: sell at market, minus 13% platform fee, $5 shipping, $2 packaging
    const profit = market * (1 - FEE_RATE) - FLAT_COSTS - maxBuy;
    // ROI from the real spread when we have a live low, else Max Buy fallback
    const buyAt = live && live.low != null && live.low > 0 ? live.low : maxBuy;
    const roi = buyAt > 0 ? ((market - buyAt - market * FEE_RATE) / buyAt) * 100 : 0;
    const dealProfit = market * (1 - FEE_RATE) - FLAT_COSTS - buyAt;
    const velocity = velocityFor(market);
    return { p, live, market, maxBuy, profit, roi, dealProfit, velocity };
  }

  const activeTier = TIER_FILTERS.find(t => t.key === tier)!;
  const visibleCards = cards.filter(c => {
    // tier filter uses the card's market price from /api/hunt directly
    if (!activeTier.inTier(c.market)) return false;
    if (starterMode) {
      const s = statsFor(c);
      if (s.velocity.tier !== "fast") return false;
      if (s.market > STARTER_MAX_PRICE) return false;
      if (s.live && s.roi < STARTER_MIN_ROI) return false; // ROI checked once live price is in
    }
    return true;
  });

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
        <div className="flex items-center gap-2 flex-wrap">
          {TIER_FILTERS.map(t => (
            <button
              key={t.key}
              onClick={() => updateTier(t.key)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border transition-colors ${
                tier === t.key
                  ? "bg-gray-800 border-yellow-400 text-white"
                  : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {t.label}{t.hint && <span className={tier === t.key ? "text-yellow-400" : "text-gray-500"}>{t.hint}</span>}
            </button>
          ))}
          <button
            onClick={toggleStarterMode}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-full border transition-colors ${
              starterMode
                ? "bg-green-950/60 border-green-700/50 text-green-400"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            <Sprout size={13} /> Starter Mode {starterMode ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => cards.length > 0 && refreshAllPrices(cards)}
            disabled={refreshing || cards.length === 0}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs font-medium px-4 py-2 rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh Prices
          </button>
        </div>
      </div>

      {/* Starter Mode banner */}
      {starterMode && (
        <div className="flex items-center gap-2 bg-green-950/40 border border-green-800/40 text-green-300 text-xs rounded-lg px-4 py-2.5">
          <Sprout size={13} className="flex-shrink-0" />
          <span>Starter Mode: cheap, fast flips only. No grading. No long holds. Build your bankroll first.</span>
        </div>
      )}

      {/* Tier filter count */}
      {cards.length > 0 && (
        <p className="text-gray-400 text-xs">
          Showing {visibleCards.length} cards · <span className="text-yellow-400 font-medium">{TIER_NAMES[tier]}</span>
        </p>
      )}

      {/* Legend */}
      <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-xs text-gray-400">
        <Info size={13} className="text-gray-500 flex-shrink-0" />
        <span>
          <span className="text-green-400 font-semibold">Max Buy Price</span> = the most you should ever pay ·{" "}
          <span className="text-white font-semibold">Est. Profit</span> = what you make after fees &amp; shipping ·{" "}
          <span className="text-green-400 font-semibold">A</span>/<span className="text-yellow-400 font-semibold">B</span>/<span className="text-red-400 font-semibold">Pass</span> = deal score
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

      {/* No cards after filters */}
      {cards.length > 0 && visibleCards.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm space-y-1">
          {starterMode ? (
            <>
              <p>No cards match Starter Mode right now (fast sellers under $40 with 20%+ ROI).</p>
              <p>Try turning Starter Mode OFF to see all cards, or check back in an hour when prices refresh.</p>
            </>
          ) : (
            <p>No cards in the {TIER_NAMES[tier]} tier right now — switch to All or check back after the next refresh.</p>
          )}
        </div>
      )}

      {/* Hunt grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibleCards.map((card) => {
          const { p, live, market, maxBuy, profit, roi, dealProfit, velocity } = statsFor(card);
          const losing = profit < 0 || roi < 0;
          const deal = dealScore(roi, dealProfit, velocity.tier);
          const isOpen = !!expanded[card.id];

          return (
            <div key={card.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 flex flex-col transition-all">
              {/* Image + name + deal score */}
              <div className="flex gap-3 mb-3">
                <div className="relative w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                  {card.image ? (
                    <Image src={card.image} alt={card.name} fill className="object-contain" sizes="64px" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-2xl">🃏</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-white text-sm leading-tight">{card.name}</div>
                    <span className={`flex-shrink-0 border text-[11px] font-bold px-2 py-0.5 rounded-full ${deal.cls}`}>
                      {deal.label}
                    </span>
                  </div>
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

              {/* Max Buy Price — THE number, straight from the hunt list */}
              <div className="bg-green-950/40 border border-green-800/40 rounded-lg px-3 py-2.5 mb-2">
                <div className="text-green-500/80 text-[11px] font-medium uppercase tracking-wide">Max Buy Price</div>
                <div className="text-green-400 text-2xl font-extrabold tabular">${fmt(maxBuy)}</div>
              </div>

              {/* Capital lock warning */}
              {bankroll > 0 && (
                <p className="text-gray-500 text-[11px] mb-3 flex items-center gap-1">
                  <Lock size={10} className="flex-shrink-0" />
                  Buying this ties up {Math.min(999, Math.round((maxBuy / bankroll) * 100))}% of your ${bankroll.toLocaleString("en-US")} bankroll for up to {velocity.days} days.
                </p>
              )}

              {/* Numbers */}
              <div className="space-y-1.5 mb-3">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Average Sell Price <span className="text-gray-600">(NM avg)</span></span>
                  <span className="text-white tabular font-medium">${fmt(market)}</span>
                </div>

                {/* Losing card: red banner instead of profit/ROI numbers */}
                {losing ? (
                  <div className="flex items-center gap-2 bg-red-950/60 border border-red-700/50 text-red-400 text-xs font-semibold rounded-lg px-3 py-2">
                    <AlertTriangle size={12} className="flex-shrink-0" />
                    Don&apos;t buy — negative ROI after fees
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Est. Profit (after fees + shipping)</span>
                      <span className={`tabular font-medium ${profit > 0 ? "text-green-400" : "text-gray-500"}`}>
                        +${fmt(profit)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">ROI</span>
                      <span className={`tabular font-medium ${roi > 0 ? "text-green-400" : "text-gray-500"}`}>
                        +{roi.toFixed(1)}%
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Expandable live detail — fetched on demand, not on page load */}
              <button
                onClick={() => toggleExpand(card)}
                className="flex items-center justify-center gap-1 text-gray-500 hover:text-yellow-400 text-[11px] font-medium mb-3 transition-colors"
              >
                {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {isOpen ? "Hide live price detail" : "Show live price detail"}
              </button>

              {isOpen && (
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 mb-3">
                  {(!p || p.status === "loading") && (
                    <div className="grid grid-cols-3 gap-2">
                      {["Cheapest Listed", "Average Sell", "Top Listing"].map(l => (
                        <div key={l} className="text-center">
                          <div className="text-gray-600 text-[10px] mb-1">{l}</div>
                          <div className="h-4 w-12 bg-gray-800 rounded animate-pulse mx-auto" />
                        </div>
                      ))}
                    </div>
                  )}
                  {p?.status === "error" && (
                    <p className="text-orange-400/80 text-xs text-center">
                      Price unavailable —{" "}
                      <button onClick={() => fetchOne(card)} className="underline hover:text-white">try again</button>
                    </p>
                  )}
                  {live && (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-blue-400 text-[10px] font-medium mb-1">Cheapest Listed</div>
                        <div className="text-white text-xs tabular font-bold">{live.low != null ? `$${fmt(live.low)}` : "—"}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-yellow-400 text-[10px] font-medium mb-1">Average Sell (NM)</div>
                        <div className="text-white text-xs tabular font-bold">${fmt(live.market)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-pink-400 text-[10px] font-medium mb-1">Top Listing</div>
                        <div className="text-white text-xs tabular font-bold">{live.high != null ? `$${fmt(live.high)}` : "—"}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
                  Find on TCGPlayer (Near Mint)
                </a>
              </div>

              {/* Why the price might differ on TCGPlayer */}
              <p className="text-gray-600 text-[10px] leading-snug mt-2 flex items-start gap-1">
                <Info size={10} className="flex-shrink-0 mt-0.5" />
                Price shown is the Near Mint average. This link pre-filters TCGPlayer to Near Mint — it otherwise lists every condition (LP/MP/HP/Damaged) at different prices.
              </p>

              {/* Sell velocity */}
              <div className="mt-3 flex justify-center">
                <span
                  title="Estimated time to sell based on card price range"
                  className={`inline-flex items-center gap-1 border text-[11px] font-medium px-2.5 py-1 rounded-full cursor-help ${velocity.cls}`}
                >
                  ⏱ {velocity.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
