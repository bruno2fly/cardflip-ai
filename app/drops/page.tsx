"use client";

/**
 * 🎯 Drops — the unified drops timeline.
 *
 * One page that answers three questions, top to bottom:
 *   🟢 BUY NOW      — what can I buy this second (verified in-stock)
 *   🟡 WATCH SOON   — what should I be ready for (predicted windows + imminent intel)
 *   🔵 COMING LATER — what's officially confirmed for the future (+ email alert)
 *
 * This page is ADDITIVE and does NOT rebuild any scraping/stock/intel logic.
 * It reuses the exact same API routes the /restocks and /releases pages use:
 *   /api/restocks         → live NowInStock listings (real direct buyUrl)
 *   /api/stock            → Best Buy + Target direct-page stock (verified url or null)
 *   /api/watchlist/status → the user's watchlist items seen in stock right now
 *   /api/predicted-drops  → predicted watch windows + community signals
 *   /api/releases         → confirmed upcoming sets + early intel
 *   /api/releases/toggle-alert → the same 7-day-before email alert prefs
 *
 * BUY-LINK SAFETY (hard rule): a green "Buy Now" CTA is only ever rendered when
 * we hold a REAL verified direct product URL (listing.buyUrl or ProductStock.url).
 * When no direct URL exists we render a muted grey "Search {Retailer} manually →"
 * link instead — visually distinct, never a primary CTA — so an unconfirmed link
 * can never masquerade as a confirmed direct hit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ShoppingCart,
  Clock,
  CalendarDays,
  Bell,
  BellOff,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { PRODUCTS, type SealedProduct } from "@/lib/products";

/* ------------------------------------------------------------------ types */

type NowInStockListing = {
  rawName: string;
  retailer: string;
  status: "in-stock" | "preorder";
  price: number | null;
  buyUrl: string;
  lastSeenInStock: string | null;
  matchedProductId?: string | null;
};

type ProductStock = {
  productId: string;
  status: "in-stock" | "out-of-stock" | "unknown";
  sku: string | null;
  url: string | null; // direct product page, or null when unverified
  price: number | null;
};

type StockResponse = {
  bestbuy?: { configured: boolean; checkedAt: number; statuses: ProductStock[] };
  target?: { configured?: boolean; checkedAt?: number; statuses: ProductStock[] };
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

type IntelItem = {
  setName: string;
  releaseDate: string | null;
  releaseDateIso: string | null;
  source: string;
  sourceUrl: string;
  confidence: "official" | "early-intel" | "unverified";
  foundAt: number;
  detail?: string;
};

type ReleaseSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string; // YYYY/MM/DD
  logoUrl: string | null;
  symbolUrl: string | null;
  daysUntil?: number;
  daysAgo?: number;
  announcedVia?: string;
};

/** Normalized card for the BUY NOW section, whatever the source. */
type BuyNowCard = {
  key: string;
  name: string;
  retailer: string;
  price: number | null;
  msrp: number | null;
  directUrl: string | null; // real verified direct URL, or null
  sourceLabel: string; // where this signal came from
  matched: boolean; // matched to a catalog product / watchlist
};

/* -------------------------------------------------------------- constants */

const productById = new Map<string, SealedProduct>(PRODUCTS.map(p => [p.id, p]));

const EVENT_LABEL: Record<DropWindow["pattern"]["eventType"], string> = {
  "new-product-drop": "New product drops",
  "restock-existing": "Existing product restocks",
  general: "General drops",
};

const RETAILER_ICON: Record<string, string> = {
  Target: "🎯",
  Walmart: "🛒",
  "Best Buy": "🔵",
  "Pokemon Center": "⚪",
  "Pokémon Center": "⚪",
};

const WINDOW_CONFIDENCE_CLASS: Record<DropWindow["pattern"]["confidence"], string> = {
  high: "bg-green-950/60 border-green-700/40 text-green-400",
  medium: "bg-yellow-950/60 border-yellow-700/40 text-yellow-400",
  low: "bg-gray-800 border-gray-700 text-gray-400",
};

/** Intel confidence → label + colour. Never render intel as "confirmed". */
const INTEL_CHIP: Record<IntelItem["confidence"], { label: string; cls: string }> = {
  official: { label: "official", cls: "bg-green-950/60 border-green-700/40 text-green-400" },
  "early-intel": { label: "corroborated leak", cls: "bg-purple-950/60 border-purple-700/40 text-purple-300" },
  unverified: { label: "unverified", cls: "bg-amber-950/60 border-amber-700/40 text-amber-300" },
};

/* ---------------------------------------------------------------- helpers */

function retailerIcon(retailer: string): string {
  return RETAILER_ICON[retailer] ?? "🏪";
}

/** A clearly-labelled manual SEARCH url (never a fake "direct" product link). */
function manualSearchUrl(retailer: string, query: string): string {
  const q = encodeURIComponent(query);
  const r = retailer.toLowerCase();
  if (r.includes("target")) return `https://www.target.com/s?searchTerm=${q}`;
  if (r.includes("best buy") || r.includes("bestbuy")) return `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`;
  if (r.includes("walmart")) return `https://www.walmart.com/search?q=${q}`;
  if (r.includes("pokemon") || r.includes("pokémon")) return `https://www.pokemoncenter.com/search/${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} ${retailer}`)}`;
}

function timeUntil(hoursAway: number): string {
  const totalMinutes = Math.max(0, Math.round(hoursAway * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours ? `${hours}h ` : ""}${minutes}m`;
}

/**
 * Imminence heuristic for early intel: only surface intel in WATCH SOON when it
 * reads as near-term — an explicit "tonight"/"today"/"tomorrow", a clock time,
 * or a firm ISO date inside the next 14 days.
 */
function isImminentIntel(i: IntelItem): boolean {
  const hay = `${i.setName} ${i.detail ?? ""} ${i.releaseDate ?? ""}`.toLowerCase();
  if (/\b(tonight|today|tomorrow|this (morning|afternoon|evening|week)|drops? (today|tonight))\b/.test(hay)) {
    return true;
  }
  if (/\b([01]?\d|2[0-3])(:\d{2})?\s*(am|pm)\b/.test(hay) || /\b\d{1,2}:\d{2}\b/.test(hay)) {
    return true;
  }
  if (i.releaseDateIso) {
    const days = (new Date(i.releaseDateIso).getTime() - Date.now()) / 86_400_000;
    if (days >= 0 && days <= 14) return true;
  }
  return false;
}

function fmtDate(d: string | null): string {
  if (!d) return "date TBA";
  const t = new Date(d.includes("/") ? d.replace(/\//g, "-") : d);
  if (isNaN(t.getTime())) return d;
  return t.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

/* ----------------------------------------------------------- section chrome */

function SectionShell({
  emoji,
  title,
  subtitle,
  count,
  accent,
  open,
  onToggle,
  children,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  count: number;
  accent: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border ${accent} bg-gray-900/40 overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-base sm:text-lg leading-tight">{title}</h2>
          <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>
        </div>
        <span className="flex-shrink-0 text-xs font-semibold text-gray-400 bg-gray-800 border border-gray-700 rounded-full px-2.5 py-1">
          {count}
        </span>
        {open ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
      </button>
      {open && <div className="px-4 sm:px-5 pb-5 pt-1">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------- page */

export default function DropsPage() {
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [restocks, setRestocks] = useState<NowInStockListing[]>([]);
  const [stock, setStock] = useState<StockResponse | null>(null);
  const [watchNow, setWatchNow] = useState<NowInStockListing[]>([]);
  const [windows, setWindows] = useState<DropWindow[]>([]);
  const [intel, setIntel] = useState<IntelItem[]>([]);
  const [upcoming, setUpcoming] = useState<ReleaseSet[]>([]);

  const [errors, setErrors] = useState<string[]>([]);

  // collapse state — all open by default
  const [openBuy, setOpenBuy] = useState(true);
  const [openWatch, setOpenWatch] = useState(true);
  const [openLater, setOpenLater] = useState(true);

  // release email-alert prefs (mirrors /releases behaviour)
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch("/api/restocks", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/stock", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/watchlist/status", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/predicted-drops", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/releases", { cache: "no-store" }).then(r => r.json()),
    ]);

    const errs: string[] = [];

    if (results[0].status === "fulfilled") setRestocks(results[0].value.listings ?? []);
    else errs.push("Live restock feed unavailable");

    if (results[1].status === "fulfilled") setStock(results[1].value ?? null);
    else errs.push("Best Buy / Target stock check unavailable");

    if (results[2].status === "fulfilled") setWatchNow(results[2].value.nowInStock ?? []);
    else errs.push("Watchlist status unavailable");

    if (results[3].status === "fulfilled") setWindows(results[3].value.patterns ?? []);
    else errs.push("Predicted drops unavailable");

    if (results[4].status === "fulfilled") {
      setIntel(results[4].value.intel ?? []);
      setUpcoming(results[4].value.upcoming ?? []);
    } else {
      errs.push("Confirmed releases unavailable");
    }

    setErrors(errs);
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Hydrate release-alert prefs once the confirmed sets are known.
  useEffect(() => {
    if (upcoming.length === 0) return;
    const ids = upcoming.map(s => s.id);
    // localStorage first (optimistic), then reconcile with the server.
    const fromLocal: Record<string, boolean> = {};
    for (const id of ids) {
      try {
        if (localStorage.getItem(`release-alert-${id}`) === "1") fromLocal[id] = true;
      } catch {
        /* ignore */
      }
    }
    if (Object.keys(fromLocal).length) setAlerts(prev => ({ ...fromLocal, ...prev }));

    fetch(`/api/releases/toggle-alert?setIds=${ids.join(",")}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (d?.prefs) setAlerts(prev => ({ ...prev, ...d.prefs }));
      })
      .catch(() => {
        /* keep local */
      });
  }, [upcoming]);

  async function toggleAlert(setId: string) {
    const next = !alerts[setId];
    setAlerts(prev => ({ ...prev, [setId]: next }));
    try {
      localStorage.setItem(`release-alert-${setId}`, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/releases/toggle-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId, enabled: next }),
      });
    } catch {
      // revert on failure so the UI never lies about the alert being set
      setAlerts(prev => ({ ...prev, [setId]: !next }));
    }
  }

  /* --------------------------------------------------- BUY NOW aggregation */

  const buyNow: BuyNowCard[] = useMemo(() => {
    const cards: BuyNowCard[] = [];
    const seen = new Set<string>(); // dedupe by direct url (or name+retailer)

    const push = (c: BuyNowCard) => {
      const dedupeKey = (c.directUrl || `${c.name}|${c.retailer}`).toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      cards.push(c);
    };

    // 1) Live NowInStock listings — real direct buyUrl.
    restocks
      .filter(l => l.status === "in-stock" && l.buyUrl)
      .forEach((l, i) => {
        const matched = l.matchedProductId ? productById.get(l.matchedProductId) : undefined;
        push({
          key: `restock-${i}`,
          name: l.rawName,
          retailer: l.retailer,
          price: l.price,
          msrp: matched?.msrp ?? null,
          directUrl: l.buyUrl,
          sourceLabel: "Live restock",
          matched: Boolean(l.matchedProductId),
        });
      });

    // 2) The user's watchlist items seen in stock right now.
    watchNow
      .filter(l => l.status !== "preorder" && l.buyUrl)
      .forEach((l, i) => {
        const matched = l.matchedProductId ? productById.get(l.matchedProductId) : undefined;
        push({
          key: `watch-${i}`,
          name: l.rawName,
          retailer: l.retailer,
          price: l.price,
          msrp: matched?.msrp ?? null,
          directUrl: l.buyUrl,
          sourceLabel: "⭐ Watchlist",
          matched: true,
        });
      });

    // 3) Best Buy + Target direct-page stock. url may be null → manual search only.
    const stockGroups: Array<{ retailer: string; statuses: ProductStock[] }> = [
      { retailer: "Best Buy", statuses: stock?.bestbuy?.statuses ?? [] },
      { retailer: "Target", statuses: stock?.target?.statuses ?? [] },
    ];
    for (const group of stockGroups) {
      group.statuses
        .filter(s => s.status === "in-stock")
        .forEach((s, i) => {
          const product = productById.get(s.productId);
          push({
            key: `${group.retailer}-${s.productId}-${i}`,
            name: product?.name ?? s.productId,
            retailer: group.retailer,
            price: s.price,
            msrp: product?.msrp ?? null,
            directUrl: s.url, // may be null → manual-search fallback in the card
            sourceLabel: `${group.retailer} live check`,
            matched: Boolean(product),
          });
        });
    }

    return cards;
  }, [restocks, watchNow, stock]);

  /* ------------------------------------------------- WATCH SOON aggregation */

  const imminentIntel = useMemo(() => intel.filter(isImminentIntel), [intel]);
  const sortedWindows = useMemo(
    () => [...windows].sort((a, b) => a.hoursAway - b.hoursAway),
    [windows]
  );
  const watchSoonCount = sortedWindows.length + imminentIntel.length;

  /* ------------------------------------------------ COMING LATER aggregation */

  const sortedUpcoming = useMemo(
    () =>
      [...upcoming].sort(
        (a, b) =>
          new Date(a.releaseDate.replace(/\//g, "-")).getTime() -
          new Date(b.releaseDate.replace(/\//g, "-")).getTime()
      ),
    [upcoming]
  );

  /* ------------------------------------------------------------------ render */

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🎯 Drops</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            One timeline: what you can buy now, what to watch for soon, and what&apos;s coming later.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center justify-center gap-2 bg-yellow-400/10 hover:bg-yellow-400/20 border border-yellow-400/30 text-yellow-400 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Loading live feed…"}</span>
        <span>Auto-refreshes every 60s</span>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-xs rounded-lg px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Some feeds didn&apos;t load: {errors.join(" · ")}. Other sections are still live.</span>
        </div>
      )}

      {/* ============================================= 🟢 BUY NOW ============ */}
      <SectionShell
        emoji="🟢"
        title="BUY NOW"
        subtitle="Verified in stock this second — a green button means a real direct link."
        count={buyNow.length}
        accent="border-green-800/40"
        open={openBuy}
        onToggle={() => setOpenBuy(o => !o)}
      >
        {buyNow.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-400 text-sm">
            {loading ? "Checking live stock…" : "Nothing verified in stock right now. Watch the next section for what's coming."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {buyNow.map(card => {
              const overMsrp = card.price != null && card.msrp != null && card.price > card.msrp;
              return (
                <div
                  key={card.key}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{card.name}</span>
                      {card.matched && (
                        <span className="bg-yellow-400/10 border border-yellow-400/30 text-yellow-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          On your list
                        </span>
                      )}
                      <span className="text-gray-600 text-[10px]">{card.sourceLabel}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-gray-300">
                        {retailerIcon(card.retailer)} {card.retailer}
                      </span>
                      <span className="text-gray-600">·</span>
                      <span className="text-gray-300">
                        {card.price == null ? "Price on site" : `$${card.price.toFixed(2)}`}
                      </span>
                      {card.msrp != null && (
                        <>
                          <span className="text-gray-600">·</span>
                          <span className="text-gray-500">MSRP ${card.msrp.toFixed(2)}</span>
                        </>
                      )}
                      {overMsrp && (
                        <span className="bg-red-950/60 border border-red-700/40 text-red-300 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                          ⚠ ${(card.price! - card.msrp!).toFixed(2)} over MSRP
                        </span>
                      )}
                    </div>
                  </div>

                  {card.directUrl ? (
                    <a
                      href={card.directUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                    >
                      <ShoppingCart size={14} /> Buy Now <ExternalLink size={13} />
                    </a>
                  ) : (
                    <a
                      href={manualSearchUrl(card.retailer, card.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="No verified direct link — this opens a retailer search so you can confirm it yourself."
                      className="inline-flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-750 border border-gray-700 text-gray-400 hover:text-gray-200 text-xs font-medium px-4 py-2.5 rounded-lg transition-colors flex-shrink-0"
                    >
                      <Search size={13} /> Search {card.retailer} manually <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionShell>

      {/* ============================================ 🟡 WATCH SOON ========== */}
      <SectionShell
        emoji="🟡"
        title="WATCH SOON"
        subtitle="Predicted restock windows and imminent intel — directional, never a guaranteed drop."
        count={watchSoonCount}
        accent="border-yellow-800/40"
        open={openWatch}
        onToggle={() => setOpenWatch(o => !o)}
      >
        {watchSoonCount === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-400 text-sm">
            {loading ? "Loading predicted windows…" : "No near-term windows or imminent intel matched right now."}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Predicted watch windows */}
            {sortedWindows.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-yellow-300 flex items-center gap-1.5">
                  <Clock size={13} /> Predicted watch windows
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sortedWindows.map(({ pattern, nextOccurrence, hoursAway }) => (
                    <div
                      key={`${pattern.retailer}-${pattern.eventType}`}
                      className="bg-gray-900 border border-yellow-700/30 rounded-xl p-4"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-semibold">
                          {retailerIcon(pattern.retailer)} {pattern.retailer}
                        </span>
                        <span className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full ${WINDOW_CONFIDENCE_CLASS[pattern.confidence]}`}>
                          {pattern.confidence} confidence
                        </span>
                      </div>
                      <div className="text-yellow-300 text-xs font-semibold mt-2">
                        {EVENT_LABEL[pattern.eventType]} · {pattern.window}
                      </div>
                      <div className="text-gray-400 text-xs mt-1">
                        Next window:{" "}
                        {new Date(nextOccurrence).toLocaleString([], {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        · in {timeUntil(hoursAway)}
                      </div>
                      {pattern.peakDay && <div className="text-gray-500 text-[11px] mt-1">Peak day: {pattern.peakDay}</div>}
                      <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">{pattern.note}</p>
                      <div className="text-gray-600 text-[10px] mt-2">Source: {pattern.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Imminent early intel */}
            {imminentIntel.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                    <Sparkles size={13} /> Imminent intel
                  </h3>
                  <span className="bg-purple-950/60 border border-purple-700/40 text-purple-300 text-[10px] font-medium px-2 py-0.5 rounded-full">
                    reported · not confirmed
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {imminentIntel.map((i, idx) => {
                    const chip = INTEL_CHIP[i.confidence];
                    return (
                      <div key={`${i.setName}-${idx}`} className="bg-gray-900 border border-purple-700/30 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-white font-semibold text-sm leading-tight">{i.setName}</h4>
                          <span className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip.cls}`}>
                            {chip.label}
                          </span>
                        </div>
                        <div className="text-gray-400 text-xs mt-1.5">Reported drop: {i.releaseDate ?? "soon"}</div>
                        {i.detail && <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">{i.detail}</p>}
                        <a
                          href={i.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-purple-950/40 border border-purple-700/40 text-purple-300 hover:text-white text-[10px] font-semibold px-2 py-1 rounded-full mt-3 transition-colors"
                        >
                          <ExternalLink size={9} /> via {i.source}
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionShell>

      {/* =========================================== 🔵 COMING LATER ========= */}
      <SectionShell
        emoji="🔵"
        title="COMING LATER"
        subtitle="Officially confirmed future sets. Set an alert to get an email 7 days before."
        count={sortedUpcoming.length}
        accent="border-blue-800/40"
        open={openLater}
        onToggle={() => setOpenLater(o => !o)}
      >
        {sortedUpcoming.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-400 text-sm">
            {loading ? "Loading confirmed releases…" : "No confirmed upcoming sets on the horizon yet."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {sortedUpcoming.map(set => {
              const on = Boolean(alerts[set.id]);
              return (
                <div
                  key={set.id}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  {set.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={set.logoUrl} alt="" className="h-10 w-16 object-contain flex-shrink-0" />
                  ) : (
                    <div className="h-10 w-16 rounded bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <CalendarDays size={16} className="text-gray-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{set.name}</span>
                      <span className="bg-green-950/60 border border-green-700/40 text-green-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                        confirmed
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {set.series} · {fmtDate(set.releaseDate)}
                      {typeof set.daysUntil === "number" && set.daysUntil >= 0 && (
                        <span className="text-gray-500"> · in {set.daysUntil}d</span>
                      )}
                      {set.announcedVia && <span className="text-gray-600"> · via {set.announcedVia}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleAlert(set.id)}
                    className={`inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex-shrink-0 border ${
                      on
                        ? "bg-yellow-400/10 border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600"
                    }`}
                  >
                    {on ? <Bell size={13} /> : <BellOff size={13} />}
                    {on ? "Alert on" : "Set alert"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionShell>

      <p className="text-gray-600 text-[11px] text-center leading-relaxed pt-2">
        Buy links only ever point to a verified direct product page. When no direct link is confirmed, you&apos;ll see a
        muted &ldquo;Search manually&rdquo; link instead — so a green button always means a real, ready-to-buy hit.
      </p>
    </div>
  );
}
