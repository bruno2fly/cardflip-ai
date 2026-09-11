"use client";

/**
 * 🎯 Drops — the drops command center.
 *
 * This page is all about what's coming: the next expected drop with a live
 * countdown and a "get ready to buy" board of the exact products, plus predicted
 * restock windows, fresh community intel, and a peek at upcoming releases.
 *
 * It does NOT show the live in-stock list — that lives on the Buy Now page
 * (/drops), so the two pages don't duplicate each other.
 *
 * Sources (all reused, nothing rebuilt):
 *   /api/drop-events      → curated drop events + their products (get-ready board)
 *   /api/predicted-drops  → predicted watch windows + live TYPA community intel
 *   /api/releases         → confirmed upcoming sets (compact peek)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Sparkles,
  Clock,
  CalendarDays,
  ShoppingCart,
  Plus,
  Check,
  Loader2,
  Radar,
  AlertTriangle,
} from "lucide-react";
import { addTargetCatalogToWatchlist } from "@/lib/watchlist";

/* ------------------------------------------------------------------ types */

type DropProduct = {
  tcin: number;
  name: string;
  msrp: number | null;
  url: string;
  tracked: boolean;
};

type DropEvent = {
  id: string;
  title: string;
  retailer: string;
  dropsAt: string;
  window: string | null;
  confidence: "confirmed" | "expected" | "rumored";
  note: string;
  sourceUrl: string | null;
  products: DropProduct[];
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

type CommunitySignal = { headline: string; ageText: string; body: string };

type ReleaseSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  daysUntil?: number;
};

/* -------------------------------------------------------------- constants */

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

const DROP_CONFIDENCE_CHIP: Record<DropEvent["confidence"], { label: string; cls: string }> = {
  confirmed: { label: "confirmed date", cls: "bg-green-950/60 border-green-700/40 text-green-400" },
  expected: { label: "expected", cls: "bg-yellow-950/60 border-yellow-700/40 text-yellow-300" },
  rumored: { label: "rumored", cls: "bg-purple-950/60 border-purple-700/40 text-purple-300" },
};

function retailerIcon(retailer: string): string {
  return RETAILER_ICON[retailer] ?? "🏪";
}

function timeUntil(hoursAway: number): string {
  const totalMinutes = Math.max(0, Math.round(hoursAway * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours ? `${hours}h ` : ""}${minutes}m`;
}

/** Live countdown to a drop time. */
function countdown(targetMs: number, now: number): { label: string; live: boolean } {
  if (Number.isNaN(targetMs)) return { label: "date TBA", live: false };
  const ms = targetMs - now;
  if (ms <= 0) return { label: "dropping now — check the links", live: true };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return { label: `${d}d ${h}h ${m}m`, live: false };
  return { label: `${h}h ${m}m ${sec}s`, live: false };
}

function fmtDate(d: string): string {
  const t = new Date(d.includes("/") ? d.replace(/\//g, "-") : d);
  if (Number.isNaN(t.getTime())) return d;
  return t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------ get-ready card */

function ProductCard({
  product,
  onTrack,
  busy,
}: {
  product: DropProduct;
  onTrack: (p: DropProduct) => void;
  busy: boolean;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">🎯 Target · TCIN {product.tcin}</div>
        <h4 className="text-sm font-semibold text-white leading-snug">{product.name}</h4>
      </div>
      <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-600">MSRP</div>
        <div className="text-white font-bold text-base">{product.msrp == null ? "—" : `$${product.msrp.toFixed(2)}`}</div>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-2.5 rounded-lg transition-colors"
        >
          <ShoppingCart size={13} /> Buy at Target <ExternalLink size={12} />
        </a>
        {product.tracked ? (
          <span className="inline-flex items-center justify-center gap-1 bg-green-950/50 border border-green-700/40 text-green-400 text-xs font-semibold px-3 py-2.5 rounded-lg">
            <Check size={13} /> Tracking
          </span>
        ) : (
          <button
            onClick={() => onTrack(product)}
            disabled={busy}
            title="Add to your watchlist so the stock monitor alerts you when it drops"
            className="inline-flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-semibold px-3 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Track
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function DropsHubPage() {
  const [events, setEvents] = useState<DropEvent[]>([]);
  const [windows, setWindows] = useState<DropWindow[]>([]);
  const [signals, setSignals] = useState<CommunitySignal[]>([]);
  const [upcoming, setUpcoming] = useState<ReleaseSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const [now, setNow] = useState(() => Date.now());
  const [trackingTcin, setTrackingTcin] = useState<number | null>(null);
  const [trackingAll, setTrackingAll] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      fetch("/api/drop-events", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/predicted-drops", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/releases", { cache: "no-store" }).then(r => r.json()),
    ]);
    const errs: string[] = [];

    if (results[0].status === "fulfilled") setEvents(results[0].value.events ?? []);
    else errs.push("Drop events unavailable");

    if (results[1].status === "fulfilled") {
      setWindows(results[1].value.patterns ?? []);
      setSignals(results[1].value.liveSignals ?? []);
    } else {
      errs.push("Predicted drops unavailable");
    }

    if (results[2].status === "fulfilled") setUpcoming(results[2].value.upcoming ?? []);
    else errs.push("Upcoming releases unavailable");

    setErrors(errs);
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // 1s tick for the live countdown
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const markTracked = useCallback((tcins: number[]) => {
    setEvents(prev =>
      prev.map(e => ({
        ...e,
        products: e.products.map(p => (tcins.includes(p.tcin) ? { ...p, tracked: true } : p)),
      }))
    );
  }, []);

  async function trackOne(p: DropProduct) {
    if (trackingTcin != null || trackingAll != null) return;
    setTrackingTcin(p.tcin);
    const result = await addTargetCatalogToWatchlist({ tcin: p.tcin, name: p.name, price: p.msrp, url: p.url });
    if (result.ok || (!result.ok && /already on your watchlist/i.test(result.reason))) markTracked([p.tcin]);
    setTrackingTcin(null);
  }

  async function trackAll(event: DropEvent) {
    if (trackingAll != null || trackingTcin != null) return;
    setTrackingAll(event.id);
    const done: number[] = [];
    for (const p of event.products) {
      if (p.tracked) continue;
      const result = await addTargetCatalogToWatchlist({ tcin: p.tcin, name: p.name, price: p.msrp, url: p.url });
      if (result.ok || (!result.ok && /already on your watchlist/i.test(result.reason))) done.push(p.tcin);
    }
    if (done.length) markTracked(done);
    setTrackingAll(null);
  }

  const sortedWindows = useMemo(() => [...windows].sort((a, b) => a.hoursAway - b.hoursAway), [windows]);
  const nextUpcoming = useMemo(
    () => [...upcoming].sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999)).slice(0, 6),
    [upcoming]
  );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Radar size={22} className="text-red-400" /> Drops
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            What&apos;s dropping next, who to watch, and the products to have ready — so you&apos;re set to buy the second it goes live.
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
        <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : "Loading…"}</span>
        <span>Auto-refreshes every 60s</span>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-xs rounded-lg px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Some feeds didn&apos;t load: {errors.join(" · ")}. Everything else is still live.</span>
        </div>
      )}

      {/* ===================================== NEXT DROP — get ready board === */}
      {events.length > 0 && (
        <section className="space-y-4">
          {events.map(event => {
            const dropMs = new Date(event.dropsAt).getTime();
            const cd = countdown(dropMs, now);
            const chip = DROP_CONFIDENCE_CHIP[event.confidence];
            const untracked = event.products.filter(p => !p.tracked).length;
            const allTracked = untracked === 0 && event.products.length > 0;
            return (
              <div key={event.id} className="rounded-2xl border border-red-800/40 bg-gradient-to-b from-red-950/20 to-gray-900/30 overflow-hidden">
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">{retailerIcon(event.retailer)}</span>
                        <h2 className="text-white font-bold text-base sm:text-lg leading-tight">{event.title}</h2>
                        <span className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
                      </div>
                      {event.window && <div className="text-gray-400 text-xs mt-1">{event.window}</div>}
                    </div>
                    {/* Countdown */}
                    <div className={`flex-shrink-0 rounded-xl border px-4 py-2 text-center ${cd.live ? "border-green-600/50 bg-green-950/40" : "border-red-700/40 bg-red-950/30"}`}>
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">{cd.live ? "Live" : "Drops in"}</div>
                      <div className={`font-bold tabular-nums ${cd.live ? "text-green-400 text-sm" : "text-white text-lg"}`}>{cd.label}</div>
                      {!cd.live && <div className="text-[10px] text-gray-500 mt-0.5">{fmtDate(event.dropsAt)}</div>}
                    </div>
                  </div>

                  <p className="text-gray-400 text-xs leading-relaxed mt-3">{event.note}</p>

                  <div className="flex items-center gap-3 flex-wrap mt-3">
                    {event.products.length > 0 && (
                      <button
                        onClick={() => trackAll(event)}
                        disabled={allTracked || trackingAll != null}
                        className="inline-flex items-center justify-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 text-xs font-bold px-3 py-2 rounded-lg transition-colors"
                      >
                        {trackingAll === event.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        {allTracked ? "All tracked" : `Track all ${untracked} product${untracked === 1 ? "" : "s"}`}
                      </button>
                    )}
                    {event.sourceUrl && (
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-300 text-[11px] transition-colors"
                      >
                        <ExternalLink size={11} /> source
                      </a>
                    )}
                  </div>

                  {/* Product grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                    {event.products.map(p => (
                      <ProductCard key={p.tcin} product={p} onTrack={trackOne} busy={trackingTcin === p.tcin || trackingAll === event.id} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {!loading && events.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-400 text-sm">
          No drop events queued right now. Predicted windows and community intel below still tell you what to watch.
        </div>
      )}

      {/* ===================================== Predicted watch windows ====== */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock size={18} className="text-yellow-400" /> Predicted watch windows
          </h2>
          <p className="text-gray-500 text-xs mt-1">Likely drop windows from historical retailer patterns — directional, never a guaranteed drop.</p>
        </div>
        {sortedWindows.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400">No predicted windows right now.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedWindows.map(({ pattern, nextOccurrence, hoursAway }) => (
              <div key={`${pattern.retailer}-${pattern.eventType}`} className="bg-gray-900 border border-yellow-700/30 rounded-xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-semibold">{retailerIcon(pattern.retailer)} {pattern.retailer}</span>
                  <span className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full ${WINDOW_CONFIDENCE_CLASS[pattern.confidence]}`}>{pattern.confidence} confidence</span>
                </div>
                <div className="text-yellow-300 text-xs font-semibold mt-2">{EVENT_LABEL[pattern.eventType]} · {pattern.window}</div>
                <div className="text-gray-400 text-xs mt-1">
                  Next window: {new Date(nextOccurrence).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · in {timeUntil(hoursAway)}
                </div>
                {pattern.peakDay && <div className="text-gray-500 text-[11px] mt-1">Peak day: {pattern.peakDay}</div>}
                <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">{pattern.note}</p>
                <div className="text-gray-600 text-[10px] mt-2">Source: {pattern.source}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===================================== Community intel (live TYPA) == */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" /> Community intel
          </h2>
          <span className="bg-purple-950/60 border border-purple-700/40 text-purple-300 text-[10px] font-medium px-2 py-0.5 rounded-full">community-reported · unverified</span>
        </div>
        {signals.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-sm text-gray-400">No forward-looking community signals matched right now.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {signals.map((signal, index) => (
              <div key={`${signal.headline}-${index}`} className="bg-gray-900 border border-purple-700/40 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-white font-semibold text-sm leading-tight">{signal.headline}</h4>
                  <span className="text-gray-500 text-[10px] whitespace-nowrap">{signal.ageText}</span>
                </div>
                {signal.body && <p className="text-gray-400 text-xs mt-2 leading-relaxed">{signal.body}</p>}
                <a href="https://www.typa.app/brands/pokemon" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 bg-purple-950/40 border border-purple-700/40 text-purple-300 hover:text-white text-[10px] font-semibold px-2 py-1 rounded-full mt-3 transition-colors">
                  <ExternalLink size={9} /> via TYPA community
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===================================== Upcoming releases (peek) ===== */}
      {nextUpcoming.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <CalendarDays size={18} className="text-blue-400" /> Upcoming releases
            </h2>
            <p className="text-gray-500 text-xs mt-1">Officially confirmed sets on the horizon. Full list &amp; email alerts on the Upcoming Releases page.</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
            {nextUpcoming.map(set => (
              <div key={set.id} className="p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{set.name}</div>
                  <div className="text-xs text-gray-500">{set.series} · releases {fmtDate(set.releaseDate)}</div>
                </div>
                {typeof set.daysUntil === "number" && (
                  <span className="flex-shrink-0 text-xs font-semibold text-blue-300 bg-blue-950/40 border border-blue-800/40 rounded-full px-2.5 py-1">
                    in {set.daysUntil}d
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
