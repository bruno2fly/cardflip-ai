"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { inventory as mockInventory } from "@/lib/data";
import { supabase, DbCard } from "@/lib/supabase";
import { velocityFor, dealScore } from "@/lib/hunt";
import { tcgNearMintUrl } from "@/lib/products";
import { Search, Zap, RefreshCw, ExternalLink, AlertTriangle, Eye, Radar, Info } from "lucide-react";

const FEE_RATE = 0.13;        // 13% marketplace fees
const SHIPPING_COST = 5;      // shipping to buyer
const PACKAGING_COST = 2;     // packaging supplies
const FLAT_COSTS = SHIPPING_COST + PACKAGING_COST;
const BUY_THRESHOLD = 25;     // gross margin % for a BUY OPPORTUNITY
const WATCH_THRESHOLD = 10;   // gross margin % for a WATCH badge
const FETCH_TIMEOUT_MS = 5000;

type ScanCard = {
  id: string | number;
  name: string;
  set: string;
  number: string;
  bought: number;
  emoji: string;
  cardImage?: string;
};

type LivePrices = {
  status: "loading" | "ok" | "error";
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  url?: string | null;
  updatedAt?: string | null;
};

type Verdict = "buy" | "watch" | "hold" | "loss";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** All flip math uses the TCG *Market* price — the realistic sell target. */
function verdictFor(cost: number, market: number): Verdict {
  if (market < cost) return "loss";
  const marginPct = ((market - cost) / cost) * 100;
  if (marginPct > BUY_THRESHOLD) return "buy";
  if (marginPct >= WATCH_THRESHOLD) return "watch";
  return "hold";
}

function plainEnglish(cost: number, market: number): string {
  if (market < cost) return "Market price is below what you paid. Hold and wait.";
  // true profit: 13% platform fee + $5 shipping + $2 packaging
  const profit = market * (1 - FEE_RATE) - FLAT_COSTS - cost;
  if (profit <= 0) {
    return `After fees + shipping you'd roughly break even (~${profit < 0 ? "-" : ""}$${fmt(Math.abs(profit))}). Hold for now.`;
  }
  return `Buy this card for $${fmt(cost)} or less → sell on TCGPlayer for ~$${fmt(market)} → est. profit $${fmt(profit)} after fees + shipping`;
}

export default function Scanner() {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<ScanCard[]>([]);
  const [prices, setPrices] = useState<Record<string, LivePrices>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [scan, setScan] = useState<{ running: boolean; message: string | null; ok: boolean }>({ running: false, message: null, ok: true });
  const usingSupabase = supabase !== null;

  // Manual trigger for the hourly email-alert scan (/api/cron/scan)
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

  // Load the card list (Supabase, falling back to mock data)
  useEffect(() => {
    (async () => {
      if (supabase) {
        const { data } = await supabase
          .from("cards")
          .select("*")
          .order("created_at", { ascending: true });
        if (data) {
          setCards((data as DbCard[]).map(r => ({
            id: r.id,
            name: r.name,
            set: r.set_name ?? "",
            number: r.card_number ?? "",
            bought: Number(r.bought),
            emoji: r.emoji || "🃏",
            cardImage: r.card_image ?? undefined,
          })));
          return;
        }
      }
      setCards(mockInventory.map(c => ({
        id: c.id, name: c.name, set: c.set, number: c.number,
        bought: c.bought, emoji: c.image, cardImage: c.cardImage,
      })));
    })();
  }, []);

  // Fetch live TCGPlayer prices from /api/prices, giving up after 5 seconds
  const fetchPrices = useCallback(async (list: ScanCard[]) => {
    setRefreshing(true);
    setPrices(prev => {
      const next = { ...prev };
      for (const c of list) next[String(c.id)] = { status: "loading" };
      return next;
    });

    await Promise.allSettled(list.map(async (c) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({ name: c.name });
        if (c.set) params.set("set", c.set);
        if (c.number) params.set("number", c.number);
        const res = await fetch(`/api/prices?${params}`, { signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setPrices(prev => ({
          ...prev,
          [String(c.id)]: {
            status: "ok",
            low: json.prices.low, mid: json.prices.mid, high: json.prices.high,
            market: json.prices.market,
            url: json.url, updatedAt: json.updatedAt,
          },
        }));
      } catch {
        setPrices(prev => ({ ...prev, [String(c.id)]: { status: "error" } }));
      } finally {
        clearTimeout(timer);
      }
    }));
    setRefreshing(false);
  }, []);

  useEffect(() => { if (cards.length > 0) fetchPrices(cards); }, [cards, fetchPrices]);

  const filtered = cards.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.set.toLowerCase().includes(query.toLowerCase())
  );

  const buyOpps = filtered.filter(c => {
    const p = prices[String(c.id)];
    return p?.status === "ok" && p.market != null && c.bought > 0 && verdictFor(c.bought, p.market) === "buy";
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Market Scanner</h1>
          <p className="text-gray-500 text-sm mt-0.5">Tracking {cards.length} cards · live TCGPlayer prices</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {buyOpps.length > 0 && (
            <div className="flex items-center gap-2 bg-green-950/60 border border-green-700/40 rounded-full px-3 py-1.5">
              <Zap size={13} className="text-green-400" />
              <span className="text-green-400 text-xs font-semibold">{buyOpps.length} Buy Opportunities</span>
            </div>
          )}
          <button
            onClick={runScanNow}
            disabled={scan.running}
            className="flex items-center gap-2 whitespace-nowrap bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
            title="Runs the hourly email-alert scan right now"
          >
            <Radar size={13} className={scan.running ? "animate-spin" : ""} /> Run Alert Scan
          </button>
          <button
            onClick={() => fetchPrices(cards)}
            disabled={refreshing}
            className="flex items-center gap-2 whitespace-nowrap bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh Live Prices
          </button>
        </div>
      </div>

      {/* Alert scan result */}
      {scan.message && (
        <div className={`text-xs rounded-lg px-4 py-2.5 border ${
          scan.ok
            ? "bg-yellow-950/40 border-yellow-800/40 text-yellow-300"
            : "bg-red-950/40 border-red-800/40 text-red-300"
        }`}>
          {scan.ok ? "Alert scan complete: " : "Alert scan failed: "}{scan.message}
        </div>
      )}

      {!usingSupabase && (
        <div className="bg-orange-950/40 border border-orange-800/40 text-orange-300 text-xs rounded-lg px-4 py-2.5">
          Supabase is not configured — scanning the demo card list. Prices shown are still live from TCGPlayer.
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search cards..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
        />
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {filtered.map(card => {
          const p = prices[String(card.id)] ?? { status: "loading" as const };
          const hasData = p.status === "ok" && p.market != null && card.bought > 0;
          const verdict: Verdict | null = hasData ? verdictFor(card.bought, p.market!) : null;
          const marginPct = hasData ? ((p.market! - card.bought) / card.bought) * 100 : null;
          // Deal score: net profit (fees + shipping) and net ROI vs your cost
          const netProfit = hasData ? p.market! * (1 - FEE_RATE) - FLAT_COSTS - card.bought : 0;
          const netRoi = hasData ? (netProfit / card.bought) * 100 : 0;
          const deal = hasData ? dealScore(netRoi, netProfit, velocityFor(p.market!).tier) : null;

          const priceCols: { label: string; value: number | null | undefined; cls: string }[] = [
            { label: "Cheapest Listed", value: p.low, cls: "text-blue-400" },
            { label: "Average Sell (NM avg)", value: p.market, cls: "text-yellow-400" },
            { label: "Top Listing", value: p.high, cls: "text-pink-400" },
          ];

          return (
            <div
              key={card.id}
              className={`bg-gray-900 border rounded-xl p-5 transition-all ${
                verdict === "buy" ? "border-green-700/50 glow-buy" : "border-gray-800"
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Card image */}
                <div className="relative w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                  {card.cardImage ? (
                    <Image src={card.cardImage} alt={card.name} fill className="object-contain" sizes="64px" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-2xl">{card.emoji}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{card.name}</span>
                    <span className="text-gray-500 text-xs">{card.set}</span>

                    {deal && (
                      <span className={`border text-[11px] font-bold px-2 py-0.5 rounded-full ${deal.cls}`}>
                        {deal.label}
                      </span>
                    )}

                    {verdict === "buy" && (
                      <span className="flex items-center gap-1 bg-green-950/80 border border-green-700/50 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full">
                        <Zap size={10} /> BUY OPPORTUNITY
                      </span>
                    )}
                    {verdict === "watch" && (
                      <span className="flex items-center gap-1 bg-yellow-950/80 border border-yellow-700/50 text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full">
                        <Eye size={10} /> WATCH — Low margin
                      </span>
                    )}
                    {verdict === "loss" && (
                      <span className="flex items-center gap-1 bg-red-950/80 border border-red-700/50 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">
                        <AlertTriangle size={10} /> LOSS — Market below your cost
                      </span>
                    )}

                    {p.status === "ok" && (
                      <a href={tcgNearMintUrl(card.name)} target="_blank" rel="noreferrer"
                        title="Opens TCGPlayer pre-filtered to Near Mint, matching the average sell price shown"
                        className="flex items-center gap-1 text-gray-500 hover:text-yellow-400 text-xs transition-colors">
                        <ExternalLink size={10} /> TCGPlayer (NM)
                      </a>
                    )}
                  </div>

                  {p.status === "ok" && p.market != null && (
                    <p className="text-gray-600 text-[10px] leading-snug mt-1.5 flex items-start gap-1">
                      <Info size={10} className="flex-shrink-0 mt-0.5" />
                      Prices are Near Mint averages. The TCGPlayer (NM) link is pre-filtered to Near Mint — it otherwise lists every condition (LP/MP/HP/Damaged) at different prices.
                    </p>
                  )}

                  {/* Signal + plain-English explanation */}
                  {p.status === "loading" && (
                    <div className="mt-2 space-y-1.5">
                      <div className="h-3 w-64 bg-gray-800 rounded animate-pulse" />
                      <div className="h-3 w-80 bg-gray-800 rounded animate-pulse" />
                    </div>
                  )}
                  {p.status === "error" && (
                    <p className="text-orange-400/80 text-xs mt-1.5">Price unavailable — try Refresh</p>
                  )}
                  {hasData && (
                    <>
                      <p className="text-gray-400 text-xs mt-1.5 italic">
                        🤖 {verdict === "buy" && `Strong flip: average sell price is ${marginPct!.toFixed(0)}% above your cost.`}
                        {verdict === "watch" && `Thin margin: average sell price is only ${marginPct!.toFixed(0)}% above your cost.`}
                        {verdict === "hold" && `Margin under ${WATCH_THRESHOLD}% — not worth flipping after fees.`}
                        {verdict === "loss" && `Average sell price is ${Math.abs(marginPct!).toFixed(0)}% below what you paid.`}
                      </p>
                      <p className="text-gray-300 text-xs mt-1">
                        {plainEnglish(card.bought, p.market!)}
                      </p>
                    </>
                  )}

                  {/* Live prices (info only — calculations use Average Sell Price) */}
                  <div className="flex gap-4 mt-3 flex-wrap">
                    {priceCols.map(({ label, value, cls }) => (
                      <div key={label} className="text-center">
                        <div className={`text-xs font-medium mb-1 ${cls}`}>{label}</div>
                        {p.status === "loading" ? (
                          <div className="h-5 w-14 bg-gray-800 rounded animate-pulse mx-auto" />
                        ) : (
                          <div className={`text-sm tabular font-bold ${value == null ? "text-gray-600" : "text-white"}`}>
                            {value == null ? "—" : `$${fmt(value)}`}
                          </div>
                        )}
                      </div>
                    ))}

                    <div className="text-center">
                      <div className="text-xs font-medium mb-1 text-gray-500">Your Cost</div>
                      <div className="text-sm tabular font-bold text-white">${fmt(card.bought)}</div>
                    </div>

                    {/* Profit margin vs Average Sell Price */}
                    {hasData && (
                      <div className="text-center ml-auto">
                        <div className="text-xs text-gray-500 mb-1">Your Profit Margin</div>
                        <div className={`text-sm font-bold tabular ${
                          verdict === "buy" ? "text-green-400" : verdict === "watch" ? "text-yellow-400" : verdict === "loss" ? "text-red-400" : "text-gray-400"
                        }`}>
                          {marginPct! >= 0 ? "+" : ""}{marginPct!.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          ${fmt(p.market! - card.bought)} gross
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <Search size={32} className="mx-auto mb-3 opacity-40" />
            <p>No cards found for &quot;{query}&quot;</p>
          </div>
        )}
      </div>
    </div>
  );
}
