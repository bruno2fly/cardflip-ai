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

// Demand callout — the hero of the card, not an afterthought.
// High-contrast blocks so the demand note reads before anything else.
const demandBanner: Record<Hotness, { label: string; cls: string; noteCls: string }> = {
  "🔥 Hot": { label: "🔥 HOT", cls: "bg-orange-500/15 border-orange-500/50", noteCls: "text-orange-200" },
  "📈 Rising": { label: "📈 RISING", cls: "bg-green-500/15 border-green-500/50", noteCls: "text-green-200" },
  "✅ Stable": { label: "✅ STABLE", cls: "bg-blue-500/10 border-blue-500/40", noteCls: "text-blue-200" },
  "❄️ Cooling": { label: "❄️ COOLING", cls: "bg-cyan-500/10 border-cyan-500/40", noteCls: "text-cyan-200" },
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/**
 * Smart manual-price seed: pull the midpoint of a "$150–200+" style range
 * out of the demand note, so the manual field starts from a real anchor
 * instead of a blank $0.00. Returns null when the note has no price range.
 */
function seedFromNotes(notes: string): number | null {
  const range = notes.match(/\$(\d+(?:\.\d+)?)\s*[–\-—]\s*\$?(\d+(?:\.\d+)?)/);
  if (range) return Math.round((parseFloat(range[1]) + parseFloat(range[2])) / 2);
  const single = notes.match(/\$(\d+(?:\.\d+)?)/);
  return single ? Math.round(parseFloat(single[1])) : null;
}

function ebayUrl(query: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${query} sealed`)}&LH_Sold=1&LH_Complete=1`;
}

// Plain-English verdict for beginners: what do I DO with this product?
type Verdict = { label: string; cls: string; Icon: typeof CheckCircle2 };
function verdictFor(roi: number): Verdict {
  if (roi > 30) return { label: "BUY", cls: "bg-green-500/20 border-green-500/60 text-green-300", Icon: CheckCircle2 };
  if (roi >= 10) return { label: "WATCH", cls: "bg-yellow-500/20 border-yellow-500/60 text-yellow-300", Icon: AlertTriangle };
  return { label: "SKIP", cls: "bg-gray-800 border-gray-600 text-gray-400", Icon: XCircle };
}
const NO_PRICE_VERDICT: Verdict = {
  label: "ADD PRICE",
  cls: "bg-gray-800 border-gray-700 text-gray-500",
  Icon: AlertTriangle,
};

export default function SealedTracker() {
  const [filter, setFilter] = useState<TypeFilter>("All");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<StockMaps>({ bestbuy: {}, target: {} });
  const [livePrices, setLivePrices] = useState<Record<string, { market: number; source: "tcgapi" | "tcgplayer-est" }>>({});
  const [lightbox, setLightbox] = useState<{ name: string; imageUrl: string } | null>(null);

  // Esc closes the image lightbox
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

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
        const map: Record<string, { market: number; source: "tcgapi" | "tcgplayer-est" }> = {};
        for (const p of json.prices) {
          if (typeof p.market === "number" && p.market > 0 && p.source) {
            map[p.productId] = { market: p.market, source: p.source };
          }
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
          const live = livePrices[product.id]; // live/est wins; manual is the fallback
          // seeded estimate from the demand note anchors the manual field
          const seed = seedFromNotes(product.notes);
          const manualStr = raw !== "" ? raw : seed != null ? String(seed) : "";
          const manual = parseFloat(manualStr);
          const market = live?.market ?? manual;
          const hasPrice = live != null || (!isNaN(manual) && manual > 0);
          const gross = hasPrice ? market - product.msrp : 0;
          const net = hasPrice ? market * (1 - FEE_RATE) - SEALED_SHIPPING - product.msrp : 0;
          const roi = hasPrice ? (net / product.msrp) * 100 : 0;
          const verdict = hasPrice ? verdictFor(roi) : NO_PRICE_VERDICT;
          const demand = demandBanner[product.hotness];

          return (
            <div key={product.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 flex flex-col transition-all">
              {/* Product image — big, clickable to inspect at full size */}
              <button
                onClick={() => setLightbox({ name: product.name, imageUrl: product.imageUrl })}
                title="Click to enlarge"
                className="relative w-full h-44 mb-3 rounded-lg overflow-hidden bg-gray-950/60 border border-gray-800 cursor-zoom-in group"
              >
                <Image src={product.imageUrl} alt={product.name} fill className="object-contain p-2 transition-transform group-hover:scale-105" sizes="(max-width: 768px) 100vw, 50vw" />
                <span className="absolute bottom-2 right-2 bg-gray-950/80 text-gray-400 text-[10px] px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  🔍 click to enlarge
                </span>
              </button>

              {/* Title + chips */}
              <div className="mb-2">
                <div className="font-semibold text-white text-sm leading-tight mb-1.5">{product.name}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-gray-800 border border-gray-700 text-gray-400 text-[11px] font-medium px-2 py-0.5 rounded-full">
                    {product.set}
                  </span>
                  <span className={`border text-[11px] font-medium px-2 py-0.5 rounded-full ${typeColors[product.type]}`}>
                    {product.type}
                  </span>
                </div>
              </div>

              {/* The story, top to bottom: verdict → demand proof → profit math */}
              <div className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 mb-3 ${demand.cls}`}>
                <span className={`flex-shrink-0 flex items-center gap-1 border text-xs font-extrabold px-2.5 py-1 rounded-lg ${verdict.cls}`}>
                  <verdict.Icon size={12} /> {verdict.label}
                </span>
                <div className="min-w-0">
                  <div className={`text-[11px] font-extrabold tracking-wide ${demand.noteCls}`}>{demand.label}</div>
                  <div className={`text-xs font-medium leading-snug ${demand.noteCls}`}>{product.notes}</div>
                </div>
              </div>

              {/* MSRP + market price input */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                  <div className="text-gray-500 text-[11px] mb-0.5">MSRP</div>
                  <div className="text-white text-base font-bold tabular">${fmt(product.msrp)} <span className="text-gray-600 text-[11px] font-normal">retail</span></div>
                </div>
                {live != null ? (
                  <div className={`bg-gray-950/60 border rounded-lg px-3 py-2.5 ${live.source === "tcgapi" ? "border-green-800/40" : "border-blue-800/40"}`}>
                    <div className="text-gray-500 text-[11px] mb-0.5 flex items-center gap-1.5">
                      Current Market Price
                      {live.source === "tcgapi" ? (
                        <span className="inline-flex items-center gap-1 bg-green-950/80 border border-green-700/50 text-green-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          <span className="w-1 h-1 rounded-full bg-green-400 inline-block" /> LIVE
                        </span>
                      ) : (
                        <span
                          title="TCGPlayer market price — secondary source, not real-time"
                          className="inline-flex items-center gap-1 bg-blue-950/80 border border-blue-700/50 text-blue-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full cursor-help"
                        >
                          <span className="w-1 h-1 rounded-full bg-blue-400 inline-block" /> EST · TCGPlayer
                        </span>
                      )}
                    </div>
                    <div className="text-white text-base font-bold tabular">${fmt(live.market)}</div>
                  </div>
                ) : (
                  <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                    <div className="text-gray-500 text-[11px] mb-0.5">
                      Current Market Price{" "}
                      <span className="text-gray-700">
                        (manual{raw === "" && seed != null ? " · seeded from demand note" : ""})
                      </span>
                    </div>
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={manualStr}
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
                    <span className="text-gray-500">ROI</span>
                    <span className={`tabular font-bold ${roi > 30 ? "text-green-400" : roi >= 10 ? "text-yellow-400" : "text-gray-400"}`}>
                      {roi >= 0 ? "+" : ""}{roi.toFixed(1)}%
                    </span>
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

      {/* Image lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[100] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out"
          role="dialog" aria-modal="true" aria-label={`${lightbox.name} image`}
        >
          <div className="relative w-full max-w-2xl h-[70vh]">
            <Image
              src={lightbox.imageUrl.replace("_in_400x400", "_in_1000x1000")}
              alt={lightbox.name}
              fill
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 672px"
            />
          </div>
          <div className="absolute bottom-6 left-0 right-0 text-center">
            <span className="bg-gray-900/90 border border-gray-700 text-gray-300 text-xs px-4 py-2 rounded-full">
              {lightbox.name} · click anywhere or press Esc to close
            </span>
          </div>
        </div>
      )}

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
