"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Search, Loader2, X, Award, Clock, DollarSign, Lightbulb, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const GRADING_FEE = 25;      // PSA Economy tier
const WAIT_DAYS = 45;        // estimated turnaround
const SELL_FEE_RATE = 0.13;  // 13% eBay/marketplace fee on graded sale
const SLAB_SHIPPING = 5;     // shipping a PSA slab to buyer
// Multipliers vs. raw ungraded TCGPlayer market price.
// PSA 10 commands a significant premium over raw; PSA 8 roughly equals raw.
const GRADE_MULTIPLIERS = [
  { grade: "PSA 10", mult: 3.0 },
  { grade: "PSA 9",  mult: 1.5 },
  { grade: "PSA 8",  mult: 1.0 },
];

type SearchResult = {
  id: string;
  name: string;
  set: { name: string; printedTotal?: number };
  number: string;
  rarity?: string;
  images?: { small?: string; large?: string };
};

type PriceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; market: number; url: string | null };

type VerdictKind = "worth" | "borderline" | "not";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function verdictFor(roi: number): VerdictKind {
  if (roi > 40) return "worth";
  if (roi >= 20) return "borderline";
  return "not";
}

const verdictStyles: Record<VerdictKind, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  worth: { label: "Worth grading", cls: "bg-green-950/80 border-green-700/50 text-green-400", Icon: CheckCircle2 },
  borderline: { label: "Borderline", cls: "bg-yellow-950/80 border-yellow-700/50 text-yellow-400", Icon: AlertTriangle },
  not: { label: "Not worth it", cls: "bg-red-950/80 border-red-700/50 text-red-400", Icon: XCircle },
};

function buildSummary(market: number, price: number, condition: string): string {
  const rows = GRADE_MULTIPLIERS.map(({ grade, mult }) => {
    const value = market * mult;
    const sellingCosts = value * SELL_FEE_RATE + SLAB_SHIPPING;
    const totalCost = price + GRADING_FEE;
    const profit = value - sellingCosts - totalCost;
    const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    return { grade, profit, roi };
  });
  const [p10, p9] = rows;

  let s: string;
  if (p10.profit <= 0) {
    s = `Even a perfect PSA 10 loses you $${fmt(Math.abs(p10.profit))}. Don't send this card in at this price.`;
  } else {
    const v = verdictFor(p10.roi);
    s = `If this card grades a PSA 10, you make $${fmt(p10.profit)} profit (${p10.roi.toFixed(0)}% ROI). ${
      v === "worth" ? "Worth sending in." : v === "borderline" ? "Borderline — only send it if it looks flawless." : "The upside is too small to justify the fee and wait."
    }`;
    const nine = Math.abs(p9.profit) < (price + GRADING_FEE) * 0.05
      ? "If it only grades a 9, you roughly break even."
      : p9.profit > 0
        ? `If it only grades a 9, you still make $${fmt(p9.profit)}.`
        : `If it only grades a 9, you lose $${fmt(Math.abs(p9.profit))}. Don't send it unless the card is mint.`;
    s += ` ${nine}`;
  }

  if (condition !== "Raw NM") {
    s += ` Heads up: a ${condition.replace("Raw ", "").replace("LP", "lightly played").replace("MP", "moderately played")} card almost never grades PSA 10 — judge this by the PSA 8–9 rows instead.`;
  }
  return s;
}

export default function Grading() {
  // --- card search (same pattern as Inventory) ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- calculator inputs ---
  const [condition, setCondition] = useState("Raw NM");
  const [price, setPrice] = useState("");
  const [priceState, setPriceState] = useState<PriceState>({ status: "idle" });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setSearching(false); setSearchError(null); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // Server-side proxy so the POKEMONTCG_API_KEY is used — direct
        // browser calls get rate-limited and silently fail in production.
        const q = encodeURIComponent(`name:*${query.trim()}*`);
        const res = await fetch(`/api/search?q=${q}&pageSize=12`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const json = await res.json();
        setResults(json.data ?? []);
        setSearchError(null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
          setSearchError("Card search failed — try again in a moment.");
        }
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function selectResult(r: SearchResult) {
    setSelected(r);
    setResults([]);
    setQuery("");
    setPriceState({ status: "loading" });
    try {
      const params = new URLSearchParams({ name: r.name, set: r.set.name, number: r.number });
      const res = await fetch(`/api/prices?${params}`);
      const json = await res.json();
      if (!res.ok || json.prices?.market == null) throw new Error();
      setPriceState({ status: "ok", market: json.prices.market, url: json.url ?? null });
    } catch {
      setPriceState({ status: "error" });
    }
  }

  const purchase = parseFloat(price);
  const ready = selected && priceState.status === "ok" && !isNaN(purchase) && purchase > 0;
  const market = priceState.status === "ok" ? priceState.market : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">PSA Grading Calculator</h1>
        <p className="text-gray-500 text-sm mt-0.5">Should Jason send it in? Search a card, enter your buy price, get a verdict.</p>
      </div>

      {/* Fee + wait time */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center">
            <DollarSign size={16} className="text-yellow-400" />
          </div>
          <div>
            <div className="text-gray-400 text-xs">PSA Grading Fee (Economy tier)</div>
            <div className="text-lg font-bold text-white tabular">${GRADING_FEE}</div>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-400/10 border border-blue-400/20 flex items-center justify-center">
            <Clock size={16} className="text-blue-400" />
          </div>
          <div>
            <div className="text-gray-400 text-xs">Estimated Wait Time</div>
            <div className="text-lg font-bold text-white tabular">{WAIT_DAYS} days</div>
          </div>
        </div>
      </div>

      {/* Card picker */}
      <div className="bg-gray-900 border border-yellow-400/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Award size={15} className="text-yellow-400" /> 1. Pick a card
        </h3>

        {!selected && (
          <>
            <div className="relative mb-3">
              {searching
                ? <Loader2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-yellow-400 animate-spin" />
                : <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />}
              <input
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
                placeholder="Search the Pokemon TCG database — e.g. Charizard ex"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {searchError && <p className="text-red-400 text-xs mb-3">{searchError}</p>}

            {results.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 max-h-96 overflow-y-auto pr-1">
                {results.map(r => (
                  <button
                    key={r.id}
                    onClick={() => selectResult(r)}
                    className="group text-left bg-gray-800 border border-gray-700 hover:border-yellow-400/50 rounded-lg p-2 transition-all"
                  >
                    <div className="relative w-full aspect-[2.5/3.5] mb-2 rounded overflow-hidden bg-gray-900">
                      {r.images?.small ? (
                        <Image src={r.images.small} alt={r.name} fill className="object-contain" sizes="120px" />
                      ) : (
                        <div className="flex items-center justify-center h-full text-2xl">🃏</div>
                      )}
                    </div>
                    <div className="text-white text-xs font-medium leading-tight truncate">{r.name}</div>
                    <div className="text-gray-500 text-[11px] truncate">{r.set.name}</div>
                    <div className="text-gray-600 text-[11px]">
                      #{r.set.printedTotal ? `${r.number}/${r.set.printedTotal}` : r.number}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
              <p className="text-gray-500 text-xs">No cards found for &quot;{query}&quot;</p>
            )}
          </>
        )}

        {selected && (
          <div className="flex gap-4">
            <div className="relative w-24 h-32 flex-shrink-0 rounded-lg overflow-hidden bg-gray-800">
              {selected.images?.small ? (
                <Image src={selected.images.small} alt={selected.name} fill className="object-contain" sizes="96px" />
              ) : (
                <div className="flex items-center justify-center h-full text-3xl">🃏</div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white font-semibold text-sm">{selected.name}</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {selected.set.name} · #{selected.set.printedTotal ? `${selected.number}/${selected.set.printedTotal}` : selected.number}
                  </div>
                  <div className="text-xs mt-1.5">
                    {priceState.status === "loading" && <span className="text-gray-500 animate-pulse">Fetching average sell price…</span>}
                    {priceState.status === "error" && <span className="text-orange-400">Price unavailable — pick another printing of this card.</span>}
                    {priceState.status === "ok" && (
                      <span className="text-yellow-400 tabular font-medium">Average sell price (ungraded): ${fmt(priceState.market)}</span>
                    )}
                  </div>
                </div>
                <button onClick={() => { setSelected(null); setPriceState({ status: "idle" }); }} className="text-gray-500 hover:text-white p-1">
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3 max-w-md">
                <select
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  value={condition} onChange={e => setCondition(e.target.value)}
                >
                  {["Raw NM", "Raw LP", "Raw MP"].map(c => <option key={c}>{c}</option>)}
                </select>
                <input
                  type="number" min="0" step="0.01"
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
                  placeholder="What would you pay? ($)"
                  value={price} onChange={e => setPrice(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results table */}
      {ready && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white">2. Grading outcomes</h3>
          </div>
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 text-xs text-gray-500 border-b border-gray-800 font-medium uppercase tracking-wide">
            <div className="col-span-2">Grade</div>
            <div className="col-span-2 text-right">Est. Market Value</div>
            <div className="col-span-2 text-right">Total Cost</div>
            <div className="col-span-2 text-right">Net Profit</div>
            <div className="col-span-1 text-right">ROI</div>
            <div className="col-span-3 text-center">Verdict</div>
          </div>
          <div className="divide-y divide-gray-800">
            {GRADE_MULTIPLIERS.map(({ grade, mult }) => {
              const value = market * mult;
              const sellingCosts = value * SELL_FEE_RATE + SLAB_SHIPPING;
              const totalCost = purchase + GRADING_FEE;
              const profit = value - sellingCosts - totalCost;
              const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
              const v = verdictStyles[verdictFor(roi)];
              return (
                <div key={grade}>
                  {/* Desktop grid row */}
                  <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-4 text-sm items-center hover:bg-gray-800/40 transition-colors">
                    <div className="col-span-2 font-semibold text-white">{grade}</div>
                    <div className="col-span-2 text-right text-white tabular">${fmt(value)}</div>
                    <div className="col-span-2 text-right text-gray-400 tabular">${fmt(totalCost)}</div>
                    <div className={`col-span-2 text-right font-semibold tabular ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {profit >= 0 ? "+" : ""}${fmt(profit)}
                    </div>
                    <div className={`col-span-1 text-right tabular text-xs font-medium ${roi > 40 ? "text-green-400" : roi >= 20 ? "text-yellow-400" : "text-red-400"}`}>
                      {roi.toFixed(0)}%
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <span className={`flex items-center gap-1 border text-xs font-bold px-2.5 py-1 rounded-full ${v.cls}`}>
                        <v.Icon size={11} /> {v.label}
                      </span>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3 hover:bg-gray-800/40 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-semibold text-white text-sm">{grade}</span>
                      <span className={`flex items-center gap-1 border text-[11px] font-bold px-2 py-0.5 rounded-full ${v.cls}`}>
                        <v.Icon size={10} /> {v.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-gray-500 text-[10px]">Value</div><div className="text-white text-xs tabular">${fmt(value)}</div></div>
                      <div><div className="text-gray-500 text-[10px]">Net Profit</div><div className={`text-xs tabular font-semibold ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>{profit >= 0 ? "+" : ""}${fmt(profit)}</div></div>
                      <div><div className="text-gray-500 text-[10px]">ROI</div><div className={`text-xs tabular ${roi > 40 ? "text-green-400" : roi >= 20 ? "text-yellow-400" : "text-red-400"}`}>{roi.toFixed(0)}%</div></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Plain-English summary */}
          <div className="px-5 py-4 border-t border-gray-800 bg-gray-950/50">
            <p className="text-gray-200 text-sm leading-relaxed">{buildSummary(market, purchase, condition)}</p>
            <p className="text-gray-600 text-xs mt-2">
              Includes ${GRADING_FEE} PSA fee · ~{WAIT_DAYS}-day wait · PSA 10 ≈ 3× raw · PSA 9 ≈ 1.5× raw · PSA 8 ≈ 1× raw · 13% eBay fees + $5 shipping deducted from sale
            </p>
          </div>
        </div>
      )}

      {/* What to look for */}
      <div className="bg-gray-900 border border-blue-800/40 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Lightbulb size={15} className="text-blue-400" /> What to look for before sending a card to PSA
        </h3>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
          <div className="flex gap-2">
            <CheckCircle2 size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span><span className="text-white font-medium">Sharp corners</span> — check all four under bright light; any whitening or fuzz usually caps the card at PSA 8.</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle2 size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span><span className="text-white font-medium">Clean surface</span> — no scratches, print lines, or fingerprints, especially on holo areas. Tilt the card against light to spot them.</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle2 size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span><span className="text-white font-medium">Centered print</span> — the borders should look even top/bottom and left/right. Worse than 60/40 centering makes a PSA 10 unlikely.</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle2 size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span><span className="text-white font-medium">Crisp edges</span> — look along each edge for chipping or silvering; the card back shows wear first.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
