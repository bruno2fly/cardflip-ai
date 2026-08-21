"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS, SealedProduct, ProductType, Hotness, tcgProductImg, tcgUrl, retailLinks } from "@/lib/products";
import type { PriceTrend } from "@/lib/priceTrend";
import { supabase } from "@/lib/supabase";
import { addCuratedProductToWatchlist, WatchlistItem } from "@/lib/watchlist";
import { Package2, Lightbulb, CheckCircle2, XCircle, ExternalLink, Archive, Loader2, X, Bell, HelpCircle, Clock, Tag, Zap, Eye } from "lucide-react";

// Live stock: Best Buy (official API) + Target (unofficial RedSky — often
// blocked, degrades to Unknown). Walmart/Pokemon Center have no API at all,
// so those stay manual-check links with no fake badges.
type StockState = "in-stock" | "out-of-stock" | "unknown";
type StockInfo = { status: StockState; url: string | null; price: number | null };
type StockMaps = { bestbuy: Record<string, StockInfo>; target: Record<string, StockInfo> };

// Decision engine (lib/verdicts.ts) — real BUY/WAIT/SELL/AVOID calls stored
// in Supabase product_verdicts by the daily compute-verdicts cron. Replaces
// the old MSRP-based ROI math entirely: that model assumed MSRP was a real
// obtainable price, which fell apart for hot/sold-out items. Retired for good.
type VerdictLabel = "BUY" | "WAIT" | "SELL" | "AVOID";
type VerdictConfidence = "High" | "Medium" | "Low";
type VerdictCitation = { url: string; title?: string };
type VerdictRow = { verdict: VerdictLabel; confidence: VerdictConfidence; reason: string; citations: VerdictCitation[] };

/** Short display label for a source link, e.g. "tcgplayer.com" */
function citationLabel(c: VerdictCitation): string {
  try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

const verdictStyles: Record<VerdictLabel, { cls: string; chipCls: string; Icon: typeof CheckCircle2 }> = {
  BUY: { cls: "border-green-800/40 bg-green-950/20", chipCls: "bg-green-500/20 border-green-500/60 text-green-300", Icon: CheckCircle2 },
  WAIT: { cls: "border-yellow-800/40 bg-yellow-950/10", chipCls: "bg-yellow-500/20 border-yellow-500/60 text-yellow-300", Icon: Clock },
  SELL: { cls: "border-blue-800/40 bg-blue-950/10", chipCls: "bg-blue-500/20 border-blue-500/60 text-blue-300", Icon: Tag },
  AVOID: { cls: "border-red-800/40 bg-red-950/10", chipCls: "bg-red-500/20 border-red-500/60 text-red-300", Icon: XCircle },
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

type MomentumBanner = { label: string; note: string; cls: string; noteCls: string; real: boolean };

/**
 * The momentum tag on a card. Prefers a REAL computed 14-day trend from
 * price_history; falls back to an honest "tracking" state once history has
 * started but isn't deep enough (1–2 points); and only for a brand-new product
 * with zero history does it fall back to the hand-typed hotness/notes.
 */
function momentumBanner(trend: PriceTrend | undefined, product: SealedProduct): MomentumBanner {
  if (trend && trend.sufficient && trend.direction && trend.percentChange != null) {
    const pct = trend.percentChange;
    const pctStr = `${pct > 0 ? "+" : ""}${pct.toFixed(0)}% / ${trend.windowDays}d`;
    const note = `Real trend from ${trend.dataPoints} tracked price points over ${trend.windowDays} days`;
    if (trend.direction === "RISING")
      return { label: `📈 RISING (${pctStr})`, note, cls: "bg-green-500/15 border-green-500/50", noteCls: "text-green-200", real: true };
    if (trend.direction === "FALLING")
      return { label: `📉 FALLING (${pctStr})`, note, cls: "bg-red-500/15 border-red-500/50", noteCls: "text-red-200", real: true };
    return { label: `➡️ STABLE (${pctStr})`, note, cls: "bg-blue-500/10 border-blue-500/40", noteCls: "text-blue-200", real: true };
  }
  if (trend && trend.dataPoints > 0) {
    return {
      label: "🆕 TRACKING",
      note: `Not enough price history yet (${trend.dataPoints}/3 points) — a real trend appears once we've logged 3+ prices`,
      cls: "bg-gray-700/20 border-gray-600/50",
      noteCls: "text-gray-300",
      real: false,
    };
  }
  // brand-new product, no price history at all → hand-typed hotness fallback
  const d = demandBanner[product.hotness];
  return { label: d.label, note: product.notes, cls: d.cls, noteCls: d.noteCls, real: false };
}

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Quick Buy Info — Jason's own shipping/billing reference for fast manual paste.
// NEVER contains payment card data.
type CheckoutProfile = {
  id?: number;
  full_name?: string; email?: string; phone?: string;
  address_line1?: string; address_line2?: string;
  city?: string; state_region?: string; postal_code?: string;
  country?: string; notes?: string; updated_at?: string;
};
const EMPTY_PROFILE: CheckoutProfile = { country: "US" };

function profileHasData(p: CheckoutProfile | null): boolean {
  return Boolean(p && (p.full_name || p.address_line1 || p.email || p.phone));
}
/** One-line address for fast paste into single-line address fields. */
function profileOneLine(p: CheckoutProfile): string {
  return [p.address_line1, p.address_line2, p.city, p.state_region, p.postal_code, p.country]
    .filter(Boolean).join(", ");
}
/** Full block for paste into multi-line / multi-field checkout forms. */
function profileBlock(p: CheckoutProfile): string {
  return [
    p.full_name,
    p.address_line1,
    p.address_line2,
    [p.city, p.state_region, p.postal_code].filter(Boolean).join(", "),
    p.country,
    p.phone,
    p.email,
  ].filter(Boolean).join("\n");
}
/** Direct Target product page when a TCIN is pinned; else the search URL. */
function targetDirectUrl(p: SealedProduct): string {
  return p.targetTcin ? `https://www.target.com/p/-/A-${p.targetTcin}` : p.targetUrl;
}

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

export default function SealedTracker() {
  const [filter, setFilter] = useState<TypeFilter>("All");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<StockMaps>({ bestbuy: {}, target: {} });
  const [livePrices, setLivePrices] = useState<Record<string, { market: number; source: "tcgapi" | "tcgplayer-est" }>>({});
  const [trends, setTrends] = useState<Record<string, PriceTrend>>({});
  const [lightbox, setLightbox] = useState<{ name: string; imageUrl: string } | null>(null);
  const [addForm, setAddForm] = useState<{ productId: string; qty: string; paid: string } | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [discovered, setDiscovered] = useState<SealedProduct[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictRow>>({});
  const [verdictEngineConfigured, setVerdictEngineConfigured] = useState<boolean | null>(null);
  // Quick Buy Info: one global shipping/billing profile (no card data ever)
  const [profile, setProfile] = useState<CheckoutProfile | null>(null);
  const [quickBuyId, setQuickBuyId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<CheckoutProfile>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [watchedTcgIds, setWatchedTcgIds] = useState<Set<number>>(new Set());
  const [watchedNames, setWatchedNames] = useState<Set<string>>(new Set());
  const [watchlistAddingId, setWatchlistAddingId] = useState<string | null>(null);
  const [watchlistErrors, setWatchlistErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/watchlist", { cache: "no-store" });
        if (!response.ok) return;
        const items = await response.json() as WatchlistItem[];
        setWatchedTcgIds(new Set(items.map(item => item.tcgProductId)));
        setWatchedNames(new Set(items.map(item => item.productName.toLowerCase())));
      } catch { /* buttons remain available when status cannot be loaded */ }
    })();
  }, []);

  async function addProductToWatchlist(product: SealedProduct) {
    if (watchlistAddingId) return;
    setWatchlistAddingId(product.id);
    setWatchlistErrors(current => ({ ...current, [product.id]: "" }));
    const result = await addCuratedProductToWatchlist(product);
    if (result.ok) {
      setWatchedTcgIds(current => new Set(current).add(result.item.tcgProductId));
      setWatchedNames(current => new Set(current).add(result.item.productName.toLowerCase()).add(product.name.toLowerCase()));
    } else if (result.reason.includes("already on your watchlist")) {
      if (product.tcgProductId) setWatchedTcgIds(current => new Set(current).add(product.tcgProductId!));
      setWatchedNames(current => new Set(current).add(product.name.toLowerCase()));
    } else {
      setWatchlistErrors(current => ({ ...current, [product.id]: result.reason }));
    }
    setWatchlistAddingId(null);
  }

  // Load the single checkout profile row (id = 1)
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.from("checkout_profile").select("*").eq("id", 1).maybeSingle();
      if (data) { setProfile(data as CheckoutProfile); setProfileForm(data as CheckoutProfile); }
    })();
  }, []);

  async function saveProfile() {
    if (!supabase) return;
    setProfileSaving(true);
    const row = { ...profileForm, id: 1, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("checkout_profile").upsert(row, { onConflict: "id" });
    if (!error) { setProfile(row); setEditingProfile(false); }
    setProfileSaving(false);
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1400);
    } catch { /* clipboard unavailable — user can still select manually */ }
  }

  // Decision engine: read whatever the daily compute-verdicts cron already
  // stored (real signals only, computed server-side). configured=null means
  // "still checking"; false means the feature is fully inert (no key yet).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/verdicts/status");
        const json = await res.json();
        setVerdictEngineConfigured(Boolean(json.configured));
      } catch {
        setVerdictEngineConfigured(false);
      }
      if (!supabase) return;
      try {
        const { data, error } = await supabase
          .from("product_verdicts")
          .select("product_id, verdict, confidence, reason, citations");
        if (error || !data) return;
        const map: Record<string, VerdictRow> = {};
        for (const row of data) {
          map[row.product_id] = { verdict: row.verdict, confidence: row.confidence, reason: row.reason, citations: Array.isArray(row.citations) ? row.citations : [] };
        }
        setVerdicts(map);
      } catch { /* honest "not available yet" state below covers this */ }
    })();
  }, []);

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

  // Real 14-day price-momentum trends (lib/priceTrend.ts). Best-effort: an
  // empty/erroring response just leaves each card on its manual hotness tag.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/price-trend");
        const json = await res.json();
        if (!res.ok || !Array.isArray(json.trends)) return;
        const map: Record<string, PriceTrend> = {};
        for (const t of json.trends as PriceTrend[]) map[t.productId] = t;
        setTrends(map);
      } catch { /* cards fall back to manual hotness */ }
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
          const hasPrice = live != null || (!isNaN(manual) && manual > 0);
          const demand = momentumBanner(trends[product.id], product);
          const verdict = verdicts[product.id];
          const isWatching = (product.tcgProductId != null && watchedTcgIds.has(product.tcgProductId))
            || watchedNames.has(product.name.toLowerCase());

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

              {/* The story, top to bottom: verdict → demand proof → signals */}
              <div className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 mb-3 ${demand.cls}`}>
                {verdict ? (
                  <span className={`flex-shrink-0 flex items-center gap-1 border text-xs font-extrabold px-2.5 py-1 rounded-lg ${verdictStyles[verdict.verdict].chipCls}`}>
                    {(() => { const { Icon } = verdictStyles[verdict.verdict]; return <Icon size={12} />; })()} {verdict.verdict}
                  </span>
                ) : (
                  <span
                    title={verdictEngineConfigured === false ? "Decision engine not enabled yet (PERPLEXITY_API_KEY not set)" : "Not yet analyzed — the daily decision engine hasn't run for this product"}
                    className="flex-shrink-0 flex items-center gap-1 border border-gray-700 bg-gray-800 text-gray-500 text-xs font-extrabold px-2.5 py-1 rounded-lg cursor-help"
                  >
                    <HelpCircle size={12} /> ANALYZING
                  </span>
                )}
                <div className="min-w-0">
                  <div className={`text-[11px] font-extrabold tracking-wide ${demand.noteCls}`}>{demand.label}</div>
                  <div className={`text-xs font-medium leading-snug ${demand.noteCls}`}>{demand.note}</div>
                </div>
              </div>

              {/* Decision engine verdict detail — confidence + real drivers, or an
                  honest "not available yet" state. The retired MSRP/ROI math never
                  comes back, even when there's no verdict yet. */}
              {verdict ? (
                <div className={`border rounded-lg px-3 py-2.5 mb-3 ${verdictStyles[verdict.verdict].cls}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-gray-500 text-[11px] font-semibold uppercase tracking-wide">Decision Engine</span>
                    <span className="text-gray-500 text-[10px] font-medium">Confidence: {verdict.confidence}</span>
                  </div>
                  <div className="text-gray-300 text-[11.5px] leading-snug whitespace-pre-line">{verdict.reason}</div>
                  {verdict.citations.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-1.5 border-t border-gray-800/60">
                      <span className="text-gray-600 text-[10px] font-medium uppercase tracking-wide">Sources</span>
                      {verdict.citations.map((c, i) => (
                        <a
                          key={c.url}
                          href={c.url}
                          target="_blank" rel="noopener noreferrer"
                          title={c.title ?? c.url}
                          className="text-[10px] text-gray-500 hover:text-yellow-400 underline decoration-gray-700 underline-offset-2 transition-colors"
                        >
                          [{i + 1}] {citationLabel(c)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 mb-3">
                  <div className="text-gray-500 text-xs">
                    {verdictEngineConfigured === false
                      ? "Analysis not yet available — the decision engine isn't enabled yet."
                      : "Analysis not yet available — waiting on the next daily decision-engine run for this product."}
                  </div>
                </div>
              )}

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

              {!hasPrice && (
                <p className="text-gray-600 text-xs italic mb-4">
                  Enter the price you see on eBay (sold listings) to track current market value.
                </p>
              )}

              {/* Actions — buying (retail) vs selling (secondary) */}
              <div className="mt-auto space-y-3">
                {!discoveredIds.has(product.id) && (
                  <div>
                    {isWatching ? (
                      <Link
                        href="/watchlist"
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-green-700/50 bg-green-950/60 px-3 py-2 text-xs font-semibold text-green-400 transition-colors hover:bg-green-950"
                      >
                        <CheckCircle2 size={13} /> Watching
                      </Link>
                    ) : (
                      <button
                        onClick={() => addProductToWatchlist(product)}
                        disabled={watchlistAddingId != null || !supabase}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-950/40 px-3 py-2 text-xs font-semibold text-gray-300 transition-colors hover:border-yellow-400/40 hover:text-yellow-400 disabled:opacity-50"
                      >
                        {watchlistAddingId === product.id ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                        {watchlistAddingId === product.id ? "Adding…" : "+ Add to Watchlist"}
                      </button>
                    )}
                    {watchlistErrors[product.id] && <p className="mt-1.5 text-xs text-red-400" role="alert">{watchlistErrors[product.id]}</p>}
                  </div>
                )}
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
                          We check Best Buy + Target every ~2 minutes — you&apos;ll get an email the moment it&apos;s confirmed back in stock. Buying from a search link below risks paying a 3rd-party markup instead of ${fmt(product.msrp)} retail.
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
                            href={targetStock.url ?? targetDirectUrl(product)}
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

                {/* Quick Buy Info — copy-paste shipping/billing at checkout speed */}
                <div>
                  <button
                    onClick={() => { setQuickBuyId(quickBuyId === product.id ? null : product.id); setEditingProfile(false); }}
                    className="w-full flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    <Zap size={12} className="text-yellow-400" /> Quick Buy Info
                  </button>

                  {quickBuyId === product.id && (
                    <div className="mt-2 bg-gray-950/60 border border-gray-800 rounded-lg p-3">
                      {!supabase ? (
                        <p className="text-orange-400/80 text-[11px]">Run supabase/checkout_profile.sql and configure Supabase to use Quick Buy Info.</p>
                      ) : editingProfile || !profileHasData(profile) ? (
                        <div className="space-y-2">
                          <div className="text-gray-400 text-[11px] font-semibold">Your shipping / billing info <span className="text-gray-600 font-normal">(no card data — name + address only)</span></div>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              ["full_name", "Full name", 2], ["address_line1", "Address line 1", 2],
                              ["address_line2", "Address line 2 (opt)", 2], ["city", "City", 1],
                              ["state_region", "State", 1], ["postal_code", "ZIP", 1], ["country", "Country", 1],
                              ["phone", "Phone", 1], ["email", "Email", 1],
                            ] as [keyof CheckoutProfile, string, number][]).map(([key, label, span]) => (
                              <input
                                key={key}
                                value={(profileForm[key] as string) ?? ""}
                                onChange={e => setProfileForm({ ...profileForm, [key]: e.target.value })}
                                placeholder={label}
                                className={`${span === 2 ? "col-span-2" : ""} bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400/50`}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveProfile} disabled={profileSaving}
                              className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {profileSaving && <Loader2 size={11} className="animate-spin" />} Save
                            </button>
                            {profileHasData(profile) && (
                              <button onClick={() => { setEditingProfile(false); setProfileForm(profile ?? EMPTY_PROFILE); }}
                                className="text-gray-500 hover:text-white text-xs px-3 py-1.5 border border-gray-700 rounded-lg">Cancel</button>
                            )}
                          </div>
                        </div>
                      ) : profile ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-400 text-[11px] font-semibold">Paste at checkout</span>
                            <button onClick={() => { setEditingProfile(true); setProfileForm(profile); }} className="text-gray-500 hover:text-yellow-400 text-[10.5px] underline">Edit</button>
                          </div>
                          <pre className="whitespace-pre-wrap text-gray-200 text-[11.5px] leading-snug bg-gray-900/60 rounded-md px-2.5 py-2 border border-gray-800">{profileBlock(profile)}</pre>
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => copyText(profileBlock(profile), `${product.id}-all`)}
                              className="bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-[10.5px] font-semibold px-2.5 py-1 rounded-full transition-colors">
                              {copied === `${product.id}-all` ? "✓ Copied" : "Copy all"}
                            </button>
                            <button onClick={() => copyText(profileOneLine(profile), `${product.id}-addr`)}
                              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-[10.5px] font-medium px-2.5 py-1 rounded-full transition-colors">
                              {copied === `${product.id}-addr` ? "✓" : "Address (1 line)"}
                            </button>
                            {profile.email && (
                              <button onClick={() => copyText(profile.email ?? "", `${product.id}-email`)}
                                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-[10.5px] font-medium px-2.5 py-1 rounded-full transition-colors">
                                {copied === `${product.id}-email` ? "✓" : "Email"}
                              </button>
                            )}
                            {profile.phone && (
                              <button onClick={() => copyText(profile.phone ?? "", `${product.id}-phone`)}
                                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-[10.5px] font-medium px-2.5 py-1 rounded-full transition-colors">
                                {copied === `${product.id}-phone` ? "✓" : "Phone"}
                              </button>
                            )}
                          </div>
                          <p className="text-gray-600 text-[10px]">No payment card data is stored — you enter the card yourself at checkout.</p>
                        </div>
                      ) : null}
                    </div>
                  )}
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
