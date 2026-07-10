"use client";
import { useState } from "react";
import Image from "next/image";
import { Boxes, Loader2, CheckCircle2, XCircle, Trophy, Info } from "lucide-react";

const FEE_RATE = 0.13;        // 13% marketplace fees
const SHIPPING_PER_CARD = 5;  // shipping per card sold
const TARGET_BID_RATIO = 0.65; // leave room for bad grades and unsold cards

type LotItem = { name: string; qty: number };

type ItemResult = LotItem & {
  status: "ok" | "error";
  market: number;          // per-card market price
  sellValue: number;       // per-card value after fees + shipping
  image: string | null;
  matchedName: string | null;
  set: string | null;
};

type Analysis = {
  items: ItemResult[];
  breakValue: number;
  targetBid: number;
  lotPrice: number;
  verdict: "go" | "nogo";
  best: ItemResult | null;
  failed: number;
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** Parse "Name x2", "2x Name", or plain "Name" — one per line or comma separated. */
function parseLot(input: string): LotItem[] {
  const tokens = input.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
  const items: LotItem[] = [];
  for (const token of tokens) {
    let name = token;
    let qty = 1;
    const tail = token.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    const head = token.match(/^(\d+)\s*[x×]?\s+(.+)$/);
    if (tail) { name = tail[1].trim(); qty = parseInt(tail[2], 10); }
    else if (head) { qty = parseInt(head[1], 10); name = head[2].trim(); }
    if (name && qty > 0) items.push({ name, qty: Math.min(qty, 99) });
  }
  return items;
}

export default function LotAnalyzer() {
  const [cardsInput, setCardsInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);

  async function analyze() {
    const items = parseLot(cardsInput);
    const lotPrice = parseFloat(priceInput);
    if (items.length === 0) { setError("Enter at least one card (one per line, or comma separated)."); return; }
    if (isNaN(lotPrice) || lotPrice <= 0) { setError("Enter what you'd pay for the whole lot."); return; }

    setError(null);
    setAnalyzing(true);
    setResult(null);

    const results: ItemResult[] = await Promise.all(items.map(async (item) => {
      try {
        const res = await fetch(`/api/prices?name=${encodeURIComponent(item.name)}`);
        const json = await res.json();
        if (!res.ok || json.prices?.market == null) throw new Error();
        const market = json.prices.market as number;
        return {
          ...item,
          status: "ok" as const,
          market,
          sellValue: market * (1 - FEE_RATE) - SHIPPING_PER_CARD,
          image: json.matched?.image ?? null,
          matchedName: json.matched?.name ?? null,
          set: json.matched?.set ?? null,
        };
      } catch {
        return { ...item, status: "error" as const, market: 0, sellValue: 0, image: null, matchedName: null, set: null };
      }
    }));

    const priced = results.filter(r => r.status === "ok");
    const breakValue = priced.reduce((s, r) => s + r.sellValue * r.qty, 0);
    const targetBid = breakValue * TARGET_BID_RATIO;
    const best = priced.length > 0
      ? priced.reduce((a, b) => (b.market > a.market ? b : a))
      : null;

    setResult({
      items: results,
      breakValue,
      targetBid,
      lotPrice,
      verdict: lotPrice <= targetBid ? "go" : "nogo",
      best,
      failed: results.length - priced.length,
    });
    setAnalyzing(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Boxes size={22} className="text-yellow-400" /> Lot Analyzer
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Paste the cards in a lot, enter the asking price, and get a Go / No-go verdict.
        </p>
      </div>

      {/* Input */}
      <div className="bg-gray-900 border border-yellow-400/20 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-white mb-2">Cards in the lot</label>
          <textarea
            rows={6}
            value={cardsInput}
            onChange={e => setCardsInput(e.target.value)}
            placeholder={"One per line (or comma separated). Quantity with x:\nUmbreon VMAX x2\nCharizard ex\nGiratina V"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50 resize-y"
          />
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label htmlFor="lotprice" className="block text-sm font-semibold text-white mb-2">What you&apos;d pay for the lot</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                id="lotprice"
                type="number" min="0" step="0.01"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                placeholder="0.00"
                className="w-40 bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2 text-sm text-white tabular focus:outline-none focus:border-yellow-400/50"
              />
            </div>
          </div>
          <button
            onClick={analyze}
            disabled={analyzing}
            className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors"
          >
            {analyzing && <Loader2 size={14} className="animate-spin" />}
            {analyzing ? "Pricing the lot…" : "Analyze Lot"}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>

      {result && (
        <>
          {/* Verdict */}
          <div className={`flex items-center gap-3 rounded-xl px-5 py-4 border ${
            result.verdict === "go"
              ? "bg-green-950/50 border-green-700/50"
              : "bg-red-950/50 border-red-700/50"
          }`}>
            {result.verdict === "go"
              ? <CheckCircle2 size={26} className="text-green-400 flex-shrink-0" />
              : <XCircle size={26} className="text-red-400 flex-shrink-0" />}
            <div>
              <div className={`text-lg font-extrabold ${result.verdict === "go" ? "text-green-400" : "text-red-400"}`}>
                {result.verdict === "go" ? "GO — buy this lot" : "NO-GO — walk away"}
              </div>
              <div className="text-gray-400 text-xs mt-0.5">
                {result.verdict === "go"
                  ? <>${fmt(result.lotPrice)} is at or under the ${fmt(result.targetBid)} target bid. Room for profit even with surprises.</>
                  : <>${fmt(result.lotPrice)} is over the ${fmt(result.targetBid)} target bid. Offer ${fmt(result.targetBid)} or less, or pass.</>}
              </div>
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-400 text-xs mb-1">Estimated Break Value</div>
              <div className="text-2xl font-bold text-white tabular">${fmt(result.breakValue)}</div>
              <div className="text-gray-600 text-[11px] mt-1">after 13% fees + ${SHIPPING_PER_CARD} shipping per card</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-400 text-xs mb-1">Target Bid (×{TARGET_BID_RATIO})</div>
              <div className="text-2xl font-bold text-yellow-400 tabular">${fmt(result.targetBid)}</div>
              <div className="text-gray-600 text-[11px] mt-1">leaves room for bad grades &amp; unsold cards</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="text-gray-400 text-xs mb-1">Your Lot Price</div>
              <div className={`text-2xl font-bold tabular ${result.verdict === "go" ? "text-green-400" : "text-red-400"}`}>
                ${fmt(result.lotPrice)}
              </div>
              <div className="text-gray-600 text-[11px] mt-1">
                {result.verdict === "go" ? "under target — good deal" : `$${fmt(result.lotPrice - result.targetBid)} over target`}
              </div>
            </div>
          </div>

          {/* Best card callout */}
          {result.best && (
            <div className="flex items-center gap-4 bg-yellow-950/30 border border-yellow-700/40 rounded-xl p-4">
              <div className="relative w-14 h-20 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                {result.best.image ? (
                  <Image src={result.best.image} alt={result.best.name} fill className="object-contain" sizes="56px" />
                ) : (
                  <div className="flex items-center justify-center h-full text-xl">🃏</div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold uppercase tracking-wide">
                  <Trophy size={13} /> Best card in the lot
                </div>
                <div className="text-white font-semibold text-sm mt-1">
                  {result.best.matchedName ?? result.best.name}
                  {result.best.set && <span className="text-gray-500 font-normal text-xs"> · {result.best.set}</span>}
                </div>
                <div className="text-gray-400 text-xs mt-0.5">
                  ${fmt(result.best.market)} market — this card alone covers {result.lotPrice > 0 ? Math.min(999, Math.round((result.best.sellValue / result.lotPrice) * 100)) : 0}% of the lot price.
                </div>
              </div>
            </div>
          )}

          {/* Per-card breakdown */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Per-card breakdown</h3>
              {result.failed > 0 && (
                <span className="text-orange-400 text-xs">{result.failed} card{result.failed === 1 ? "" : "s"} couldn&apos;t be priced (excluded from totals)</span>
              )}
            </div>
            <div className="divide-y divide-gray-800">
              {result.items.map((item, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3">
                  <div className="relative w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-gray-800">
                    {item.image ? (
                      <Image src={item.image} alt={item.name} fill className="object-contain" sizes="40px" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-sm">🃏</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {item.matchedName ?? item.name}
                      {item.qty > 1 && <span className="text-yellow-400 text-xs font-semibold ml-1.5">×{item.qty}</span>}
                    </div>
                    {item.set && <div className="text-gray-500 text-xs truncate">{item.set}</div>}
                  </div>
                  {item.status === "ok" ? (
                    <div className="flex gap-6 text-right">
                      <div>
                        <div className="text-gray-500 text-[11px]">Market</div>
                        <div className="text-white text-sm tabular font-medium">${fmt(item.market)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-[11px]">Sell value after fees</div>
                        <div className={`text-sm tabular font-medium ${item.sellValue > 0 ? "text-green-400" : "text-red-400"}`}>
                          ${fmt(item.sellValue)}{item.qty > 1 && <span className="text-gray-500 text-xs"> ea</span>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span className="text-orange-400/80 text-xs">Price unavailable</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-gray-600 text-xs">
            <Info size={12} className="flex-shrink-0" />
            <span>Market prices are live TCGPlayer values via the Pokemon TCG API. Cards that can&apos;t be matched are left out of the totals — price those by hand before bidding.</span>
          </div>
        </>
      )}
    </div>
  );
}
