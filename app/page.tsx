"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS, SealedProduct, ProductType, Hotness, tcgProductImg, tcgUrl, retailLinks } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import { Package2, Lightbulb, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Archive, Loader2, X, Bell } from "lucide-react";

const FEE_RATE = 0.13;        // 13% marketplace fees
const SEALED_SHIPPING = 8;    // sealed product ships heavier — padded box + tracking

// Live stock: Best Buy (official API) + Target (unofficial RedSky — often
// blocked, degrades to Unknown). Walmart/Pokemon Center have no API at all,
// so those stay manual-check links with no fake badges.
type StockState = "in-stock" | "out-of-stock" | "unknown";
type StockInfo = { status: StockState; url: string | null; price: number | null };
type StockMaps = { bestbuy: Record<string, StockInfo>; target: Record<string, StockInfo> };


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
  const [addForm, setAddForm] = useState<{ productId: string; qty: string; paid: string } | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [discovered, setDiscovered] = useState<SealedProduct[]>([]);

  // Auto-discovered products: VERIFIED rows only, deduped against the curated
  // array by TCGPlayer product id. Curated products always stay visible.
  useEffect(() => {
    (async () => {
      if (!supabase) return;
      try {
        const { data, error } = await supabase
          .from("discovered_products")
          .select("*")
          .eq("status", "verified")
          .order("discovered_at", { ascending: false });
        if (error || !data) return;
        const curatedIds = new Set(PRODUCTS.map(p => p.tcgProductId).filter(Boolean));
        const rows = data.filter(r => r.tcg_product_id && !curatedIds.has(Number(r.tcg_product_id)));
        setDiscovered(rows.map((r): SealedProduct => {
          const name: string = r.verified_name ?? r.candidate_name;
          const market = r.market_price != null ? Number(r.market_price) : null;
          const msrp = r.msrp != null ? Number(r.msrp) : 49.99;
          const ratio = market != null && msrp > 0 ? market / msrp : 1;
          return {
            id: `disc-${r.tcg_product_id}`,
            name,
            set: "Auto-discovered",
            type: (r.product_type ?? "ETB") as ProductType,
            msrp,
            tcgplayerUrl: tcgUrl(name),
            ...retailLinks(`Pokemon ${name}`),
            ebayQuery: `Pokemon ${name}`,
            imageUrl: tcgProductImg(Number(r.tcg_product_id)),
            tcgProductId: Number(r.tcg_product_id),
            hotness: ratio >= 2 ? "🔥 Hot" : ratio >= 1.3 ? "📈 Rising" : "✅ Stable",
            notes: market != null
              ? `Found trending — ~$${market.toFixed(0)} vs $${msrp.toFixed(0)} assumed retail (${ratio.toFixed(1)}×)`
              : "Found trending — verify current pricing before buying",
          };
        }));
      } catch { /* discovery is additive; curated list always renders */ }
    })();
  }, []);

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
        const toMap = (statuses?: { productId: string; status: StockState; url: string | null; price?: number | null }[]) => {
          const map: Record<string, StockInfo> = {};
          for (const s of statuses ?? []) map[s.productId] = { status: s.status, url: s.url, price: s.price ?? null };
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

  // Log an actual purchase into sealed_inventory (the sealed flip loop starts here)
  async function saveToInventory() {
    if (!supabase || !addForm) return;
    const qty = parseInt(addForm.qty, 10);
    const paid = parseFloat(addForm.paid);
    if (isNaN(qty) || qty < 1 || isNaN(paid) || paid <= 0) return;
    const product = allProducts.find(p => p.id === addForm.productId);
    if (!product) return;
    setAddSaving(true);
    const { error } = await supabase.from("sealed_inventory").insert({
      product_id: product.id,
      product_name: product.name,
      qty,
      bought_price: paid,
      current_market: livePrices[product.id]?.market ?? seedFromNotes(product.notes) ?? product.msrp,
    });
    setAddSaving(false);
    if (!error) {
      setAdded(prev => ({ ...prev, [product.id]: true }));
      setAddForm(null);
    }
  }

  const allProducts = [...PRODUCTS, ...discovered];
  const discoveredIds = new Set(discovered.map(d => d.id));
  const visible = filter === "All" ? allProducts : allProducts.filter(p => p.type === filter);

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

          // Real acquisition risk: the market price above is genuinely live/verified
          // data, but MSRP is just the list price -- whether Jason can actually buy
          // AT that price right now is a completely separate question. Hot items are
          // hot precisely because they're hard to find at MSRP, so this check feeds
          // both the MSRP box and the profit math, not just the retail buttons below.
          const targetStockTop = stock.target[product.id] ?? { status: "unknown" as const, url: null, price: null };
          const bestbuyStockTop = stock.bestbuy[product.id] ?? { status: "unknown" as const, url: null, price: null };
          const msrpVerified = targetStockTop.status === "in-stock" || bestbuyStockTop.status === "in-stock";

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
                  {!discoveredIds.has(product.id) && (
                    <span className="bg-gray-800 border border-gray-700 text-gray-400 text-[11px] font-medium px-2 py-0.5 rounded-full">
                      {product.set}
                    </span>
                  )}
                  <span className={`border text-[11px] font-medium px-2 py-0.5 rounded-full ${typeColors[product.type]}`}>
                    {product.type}
                  </span>
                  {discoveredIds.has(product.id) && (
                    <span
                      title="Found automatically by the daily discovery scan and verified against real TCGPlayer data"
                      className="bg-teal-950/60 border border-teal-700/40 text-teal-400 text-[11px] font-medium px-2 py-0.5 rounded-full cursor-help"
                    >
                      ✨ Auto-discovered
                    </span>
                  )}
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
                <div className={`bg-gray-950/60 border rounded-lg px-3 py-2.5 ${msrpVerified ? "border-gray-800" : "border-red-800/40"}`}>
                  <div className="text-gray-500 text-[11px] mb-0.5 flex items-center gap-1.5">
                    MSRP
                    {!msrpVerified && (
                      <span
                        title="No retailer currently confirms this in stock at MSRP — real-world buy price may be higher"
                        className="inline-flex items-center gap-1 bg-red-950/80 border border-red-700/50 text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full cursor-help"
                      >
                        ⚠️ unverified
                      </span>
                    )}
                  </div>
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

              {/* Profit math — ONLY shown as actionable when a retailer has verified
                  real stock at MSRP. Otherwise this would be fake numbers Jason
                  can't actually realize by buying today, so we don't pretend. */}
              {hasPrice && msrpVerified ? (
                <div className="bg-gray-950/60 border border-green-800/40 rounded-lg px-3 py-2.5 mb-4 space-y-1.5">
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
              ) : hasPrice ? (
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 mb-4">
                  <div className="text-gray-500 text-xs">
                    Profit math hidden — no retailer currently confirms real stock at ${fmt(product.msrp)} MSRP, so gross/net/ROI here would assume a price you can&apos;t actually pay right now.
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 text-xs italic mb-4">
                  Enter the price you see on eBay (sold listings) to calculate your profit.
                </p>
              )}

              {/* Actions — buying (retail) vs selling (secondary) */}
              <div className="mt-auto space-y-3">
                {(() => {
                  const targetStock = stock.target[product.id] ?? { status: "unknown" as const, url: null, price: null };
                  const bestbuyStock = stock.bestbuy[product.id] ?? { status: "unknown" as const, url: null, price: null };
                  const verifiedRetailer = targetStock.status === "in-stock" ? { label: "Target", stock: targetStock, url: targetStock.url ?? product.targetUrl }
                    : bestbuyStock.status === "in-stock" ? { label: "Best Buy", stock: bestbuyStock, url: bestbuyStock.url ?? product.bestbuyUrl }
                    : null;

                  // REAL restock confirmed — this is the actionable, trustworthy state.
                  // The same signal that drives the 30-min restock-alert cron.
                  if (verifiedRetailer) {
                    return (
                      <div>
                        <div className="text-green-500/80 text-[10px] font-semibold uppercase tracking-wide mb-1.5">
                          Verified In Stock — Buy Now
                        </div>
                        <a
                          href={verifiedRetailer.url}
                          target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 bg-green-500/15 hover:bg-green-500/25 border border-green-500/60 text-green-300 text-sm font-bold px-4 py-2.5 rounded-lg transition-colors"
                        >
                          <CheckCircle2 size={14} />
                          Buy at {verifiedRetailer.label}
                          {verifiedRetailer.stock.price ? ` — verified $${fmt(verifiedRetailer.stock.price)}` : " — confirmed in stock"}
                        </a>
                      </div>
                    );
                  }

                  // NOT verified anywhere — don't dress up blind search links as
                  // "Buy at Retail" actions. Be honest: we're watching, not buying.
                  return (
                    <div>
                      <div className="flex items-start gap-2 bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 mb-2">
                        <Bell size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-gray-400 leading-snug">
                          <span className="text-gray-300 font-semibold">Not verified in stock at MSRP right now.</span>{" "}
                          We check Best Buy + Target every 30 minutes — you&apos;ll get an email the moment it&apos;s confirmed back in stock. Buying from a search link below risks paying a 3rd-party markup instead of ${fmt(product.msrp)} retail.
                        </div>
                      </div>
                      <details className="group">
                        <summary className="text-[10.5px] text-gray-600 hover:text-gray-400 cursor-pointer select-none list-none flex items-center gap-1">
                          <span className="group-open:hidden">Show unverified search links anyway</span>
                          <span className="hidden group-open:inline">Hide unverified search links</span>
                        </summary>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                          <a
                            href={product.walmartUrl}
                            target="_blank" rel="noopener noreferrer"
                            title="Walmart: no live stock check — this is a blind search link, may show 3rd-party marked-up listings"
                            className="flex flex-col items-center justify-center bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors"
                          >
                            Walmart
                            <span className="text-[9px] font-medium leading-tight text-red-400">⚠️ Unverified</span>
                          </a>
                          <a
                            href={targetStock.url ?? product.targetUrl}
                            target="_blank" rel="noopener noreferrer"
                            title="Target: unofficial API check found no confirmed stock — may lead to 3rd-party marked-up listings"
                            className="flex flex-col items-center justify-center bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors"
                          >
                            Target
                            <span className="text-[9px] font-medium leading-tight text-red-400">⚠️ Unverified</span>
                          </a>
                          <a
                            href={bestbuyStock.url ?? product.bestbuyUrl}
                            target="_blank" rel="noopener noreferrer"
                            title="Best Buy: live check found no confirmed stock — may lead to 3rd-party marked-up listings"
                            className="flex flex-col items-center justify-center bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors"
                          >
                            Best Buy
                            <span className="text-[9px] font-medium leading-tight text-red-400">⚠️ Unverified</span>
                          </a>
                          <a
                            href={product.pokemonCenterUrl}
                            target="_blank" rel="noopener noreferrer"
                            title="Pokemon Center: no live stock check — this is a blind search link, item may be sold out or unrelated"
                            className="flex flex-col items-center justify-center bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-colors"
                          >
                            Pkmn Center
                            <span className="text-[9px] font-medium leading-tight text-red-400">⚠️ Unverified</span>
                          </a>
                        </div>
                      </details>
                    </div>
                  );
                })()}
                {/* Bought it? Log it — starts the sealed flip loop */}
                {addForm?.productId === product.id ? (
                  <div className="flex items-end gap-2 flex-wrap bg-gray-950/60 border border-green-700/30 rounded-lg p-3">
                    <div>
                      <div className="text-gray-500 text-[11px] mb-1">Qty</div>
                      <input
                        type="number" min="1" step="1" autoFocus
                        value={addForm.qty}
                        onChange={e => setAddForm({ ...addForm, qty: e.target.value })}
                        className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white tabular focus:outline-none focus:border-green-500/50"
                      />
                    </div>
                    <div>
                      <div className="text-gray-500 text-[11px] mb-1">Paid $ / unit</div>
                      <input
                        type="number" min="0" step="0.01"
                        value={addForm.paid}
                        onChange={e => setAddForm({ ...addForm, paid: e.target.value })}
                        className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white tabular focus:outline-none focus:border-green-500/50"
                      />
                    </div>
                    <button
                      onClick={saveToInventory}
                      disabled={addSaving}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {addSaving && <Loader2 size={12} className="animate-spin" />} Save
                    </button>
                    <button onClick={() => setAddForm(null)} className="text-gray-500 hover:text-white p-1"><X size={14} /></button>
                    {!supabase && <p className="w-full text-orange-400/80 text-[11px]">Supabase not configured — run supabase/sealed_inventory.sql first.</p>}
                  </div>
                ) : added[product.id] ? (
                  <Link
                    href="/sealed-inventory"
                    className="flex items-center justify-center gap-1.5 bg-green-950/60 border border-green-700/50 text-green-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors hover:bg-green-950"
                  >
                    <CheckCircle2 size={12} /> Added — view Sealed Inventory
                  </Link>
                ) : (
                  <button
                    onClick={() => setAddForm({ productId: product.id, qty: "1", paid: String(product.msrp) })}
                    className="flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-green-700/40 text-green-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    <Archive size={12} /> Bought it? Add to Inventory
                  </button>
                )}

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
