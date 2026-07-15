"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { PRODUCTS, ProductType, Hotness } from "@/lib/products";
import { Package2, Lightbulb, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from "lucide-react";

const FEE_RATE = 0.13;        // 13% marketplace fees
const SEALED_SHIPPING = 8;    // sealed product ships heavier — padded box + tracking

// Live stock: Best Buy (official API) + Target (unofficial RedSky — often
// blocked, degrades to Unknown). Walmart/Pokemon Center have no API at all,
// so those stay manual-check links with no fake badges.
type StockState = "in-stock" | "out-of-stock" | "unknown";
type StockInfo = { status: StockState; url: string | null };
type StockMaps = { bestbuy: Record<string, StockInfo>; target: Record<string, StockInfo> };

const stockBadge: Record<StockState, { label: string; cls: string }> = {
  "in-stock": { label: "● In Stock", cls: "text-green-400" },
  "out-of-stock": { label: "● Out of Stock", cls: "text-red-400" },
  "unknown": { label: "● Unknown", cls: "text-gray-500" },
};


type TypeFilter = "All" | "ETB" | "Booster Box" | "Booster Bundle";
const FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "All", label: "All" },
  { key: "ETB", label: "ETB" },
  { key: "Booster Box", label: "Booster Box" },
  { key: "Booster Bundle", label: "Bundle" },
];

const typeColors: Record<ProductType, string> = {
  "ETB": "bg-purple-950/60 border-purple-700/40 text-purple-400",
  "Booster Box": "bg-blue-950/60 border-blue-700/40 text-blue-400",
  "Booster Bundle": "bg-green-950/60 border-green-700/40 text-green-400",
  "Premium Collection": "bg-yellow-950/60 border-yellow-700/40 text-yellow-400",
  "Booster Pack": "bg-gray-800 border-gray-700 text-gray-400",
};

const hotnessColors: Record<Hotness, string> = {
  "🔥 Hot": "bg-orange-950/60 border-orange-700/40 text-orange-400",
  "📈 Rising": "bg-green-950/60 border-green-700/40 text-green-400",
  "✅ Stable": "bg-gray-800 border-gray-700 text-gray-400",
  "❄️ Cooling": "bg-blue-950/60 border-blue-700/40 text-blue-400",
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function ebayUrl(query: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${query} sealed`)}&LH_Sold=1&LH_Complete=1`;
}

type Verdict = { label: string; cls: string; Icon: typeof CheckCircle2 };
function verdictFor(roi: number): Verdict {
  if (roi > 30) return { label: "Flip It", cls: "bg-green-950/80 border-green-700/50 text-green-400", Icon: CheckCircle2 };
  if (roi >= 10) return { label: "Watch", cls: "bg-yellow-950/80 border-yellow-700/50 text-yellow-400", Icon: AlertTriangle };
  return { label: "Pass", cls: "bg-red-950/80 border-red-700/50 text-red-400", Icon: XCircle };
}

export default function SealedTracker() {
  const [filter, setFilter] = useState<TypeFilter>("All");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<StockMaps>({ bestbuy: {}, target: {} });
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  // Market prices persist per product in localStorage (pack-price-{id})
  useEffect(() => {
    const loaded: Record<string, string> = {};
    for (const p of PRODUCTS) {
      const stored = localStorage.getItem(`pack-price-${p.id}`);
      if (stored) loaded[p.id] = stored;
    }
    setPrices(loaded);
  }, []);

  // Live stock (Best Buy + Target) — server-cached 15 min; best-effort
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/stock");
        const json = await res.json();
        if (!res.ok) return;
        const toMap = (statuses?: { productId: string; status: StockState; url: string | null }[]) => {
          const map: Record<string, StockInfo> = {};
          for (const s of statuses ?? []) map[s.productId] = { status: s.status, url: s.url };
          return map;
        };
        setStock({ bestbuy: toMap(json.bestbuy?.statuses), target: toMap(json.target?.statuses) });
      } catch { /* badges just stay "Unknown" */ }
    })();
  }, []);

  function updatePrice(id: string, value: string) {
    setPrices(prev => ({ ...prev, [id]: value }));
    if (value.trim()) localStorage.setItem(`pack-price-${id}`, value);
    else localStorage.removeItem(`pack-price-${id}`);
  }

  // Live sealed prices via tcgapi.dev — best-effort; missing data just
  // means the manual input stays in charge for that product
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/sealed-prices");
        const json = await res.json();
        if (!res.ok || !json.prices) return;
        const map: Record<string, number> = {};
        for (const p of json.prices) {
          if (typeof p.market === "number" && p.market > 0) map[p.productId] = p.market;
        }
        setLivePrices(map);
      } catch { /* manual input remains the source */ }
    })();
  }, []);

  const visible = filter === "All" ? PRODUCTS : PRODUCTS.filter(p => p.type === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Package2 size={22} className="text-yellow-400" /> Sealed Product Tracker
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Buy sealed at retail. Sell when stock runs out. No pack-ripping required.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-semibold px-4 py-2 rounded-full border transition-colors ${
              filter === f.key
                ? "bg-gray-800 border-yellow-400 text-white"
                : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm">
          No {filter} products tracked yet — check back after the next list update.
        </div>
      )}

      {/* Product cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map(product => {
          const raw = prices[product.id] ?? "";
          const live = livePrices[product.id]; // live wins; manual is the fallback
          const manual = parseFloat(raw);
          const market = live ?? manual;
          const hasPrice = live != null || (!isNaN(manual) && manual > 0);
          const gross = hasPrice ? market - product.msrp : 0;
          const net = hasPrice ? market * (1 - FEE_RATE) - SEALED_SHIPPING - product.msrp : 0;
          const roi = hasPrice ? (net / product.msrp) * 100 : 0;
          const verdict = hasPrice ? verdictFor(roi) : null;

          return (
            <div key={product.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 flex flex-col transition-all">
              {/* Image + name + badges */}
              <div className="flex gap-3 mb-2">
                <div className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                  <Image src={product.imageUrl} alt={product.name} fill className="object-contain" sizes="80px" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="font-semibold text-white text-sm leading-tight">{product.name}</div>
                    <span className={`flex-shrink-0 border text-[11px] font-medium px-2 py-0.5 rounded-full ${hotnessColors[product.hotness]}`}>
                      {product.hotness}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-gray-800 border border-gray-700 text-gray-400 text-[11px] font-medium px-2 py-0.5 rounded-full">
                      {product.set}
                    </span>
                    <span className={`border text-[11px] font-medium px-2 py-0.5 rounded-full ${typeColors[product.type]}`}>
                      {product.type}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-gray-500 text-xs mb-4">{product.notes}</p>

              {/* MSRP + market price input */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                  <div className="text-gray-500 text-[11px] mb-0.5">MSRP</div>
                  <div className="text-white text-base font-bold tabular">${fmt(product.msrp)} <span className="text-gray-600 text-[11px] font-normal">retail</span></div>
                </div>
                {live != null ? (
                  <div className="bg-gray-950/60 border border-green-800/40 rounded-lg px-3 py-2.5">
                    <div className="text-gray-500 text-[11px] mb-0.5 flex items-center gap-1.5">
                      Current Market Price
                      <span className="inline-flex items-center gap-1 bg-green-950/80 border border-green-700/50 text-green-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        <span className="w-1 h-1 rounded-full bg-green-400 inline-block" /> LIVE
                      </span>
                    </div>
                    <div className="text-white text-base font-bold tabular">${fmt(live)}</div>
                  </div>
                ) : (
                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                    <div className="text-gray-500 text-[11px] mb-0.5">Current Market Price <span className="text-gray-700">(manual)</span></div>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={raw}
                        onChange={e => updatePrice(product.id, e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-transparent border-0 border-b border-gray-700 focus:border-yellow-400/60 pl-4 py-0.5 text-base font-bold text-white tabular placeholder-gray-700 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Profit math or prompt */}
              {hasPrice ? (
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 mb-4 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Gross Profit</span>
                    <span className={`tabular font-medium ${gross >= 0 ? "text-white" : "text-red-400"}`}>
                      {gross >= 0 ? "+" : ""}${fmt(gross)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Net Profit (after 13% fees + ${SEALED_SHIPPING} shipping)</span>
                    <span className={`tabular font-medium ${net > 0 ? "text-green-400" : "text-red-400"}`}>
                      {net >= 0 ? "+" : ""}${fmt(net)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-800">
                    <span className="text-gray-500">ROI <span className="tabular font-medium text-white ml-1">{roi >= 0 ? "+" : ""}{roi.toFixed(1)}%</span></span>
                    {verdict && (
                      <span className={`flex items-center gap-1 border text-[11px] font-bold px-2.5 py-1 rounded-full ${verdict.cls}`}>
                        <verdict.Icon size={11} /> {verdict.label}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 text-xs italic mb-4">
                  Enter the price you see on eBay (sold listings) to calculate your profit.
                </p>
              )}

              {/* Actions — buying (retail) vs selling (secondary) */}
              <div className="mt-auto space-y-3">
                <div>
                  <div className="text-green-500/80 text-[10px] font-semibold uppercase tracking-wide mb-1.5">
                    Buy at Retail
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <a
                      href={product.walmartUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[11px] font-semibold px-2 py-2 rounded-lg transition-colors"
                    >
                      Walmart
                    </a>
                    {(() => {
                      const s = stock.target[product.id] ?? { status: "unknown" as const, url: null };
                      const badge = stockBadge[s.status];
                      return (
                        <a
                          href={s.url ?? product.targetUrl}
                          target="_blank" rel="noopener noreferrer"
                          title={`Target: ${s.status.replace(/-/g, " ")} (live check — unofficial API, may show Unknown)`}
                          className={`flex flex-col items-center justify-center bg-red-500/10 hover:bg-red-500/20 border text-red-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors ${
                            s.status === "in-stock" ? "border-green-500/50" : "border-red-500/30"
                          }`}
                        >
                          Target
                          <span className={`text-[9px] font-medium leading-tight ${badge.cls}`}>{badge.label}</span>
                        </a>
                      );
                    })()}
                    {(() => {
                      const s = stock.bestbuy[product.id] ?? { status: "unknown" as const, url: null };
                      const badge = stockBadge[s.status];
                      return (
                        <a
                          href={s.url ?? product.bestbuyUrl}
                          target="_blank" rel="noopener noreferrer"
                          title={`Best Buy: ${s.status.replace(/-/g, " ")} (live check)`}
                          className={`flex flex-col items-center justify-center bg-yellow-500/10 hover:bg-yellow-500/20 border text-yellow-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors ${
                            s.status === "in-stock" ? "border-green-500/50" : "border-yellow-500/30"
                          }`}
                        >
                          Best Buy
                          <span className={`text-[9px] font-medium leading-tight ${badge.cls}`}>{badge.label}</span>
                        </a>
                      );
                    })()}
                    <a
                      href={product.pokemonCenterUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-[11px] font-semibold px-2 py-2 rounded-lg transition-colors"
                    >
                      Pkmn Center
                    </a>
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide mb-1.5">
                    Resell Market
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={product.tcgplayerUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-gray-900 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      Find on TCGPlayer <ExternalLink size={11} />
                    </a>
                    <a
                      href={ebayUrl(product.ebayQuery)}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      Find on eBay <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tips */}
      <div className="bg-gray-900 border border-gray-800 border-l-4 border-l-yellow-400 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Lightbulb size={15} className="text-yellow-400" /> Sealed flipping rules
        </h3>
        <ul className="space-y-2 text-xs text-gray-400 leading-relaxed">
          <li>· Buy at retail (Walmart, Target, Pokemon Center online) — never secondary.</li>
          <li>· Check eBay SOLD listings, not asking prices — that&apos;s what people actually pay.</li>
          <li>· ETBs and booster boxes appreciate when the print run ends — patience wins.</li>
          <li>· Shipping sealed product costs more — budget $8 for padded box + tracking.</li>
          <li>· 🔥 Hot products: list within 48h of buying. 📈 Rising: hold 30–60 days. ✅ Stable: sell when you need cash.</li>
        </ul>
      </div>
    </div>
  );
}
