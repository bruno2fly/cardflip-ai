"use client";

/**
 * 🤖 Buy Bot — the DropBot mission control.
 *
 * The hub of the whole platform: everything about catching drops lives here.
 *   • Status strip   — both agents, master arm, NEXT DROP WINDOW countdown, order stats
 *   • Add product    — paste ANY Target link → the bot can hunt it (lookup → cap → arm)
 *   • Drops radar    — upcoming drops with TYPE badges (street date, overnight
 *                     restock, drawing, invite, queue), countdowns, one-click arm
 *   • Drop windows   — when the bot fast-polls (5s) instead of the safe cadence
 *   • Targets        — the armed watchlist, each with auto-buy toggle + Buy now
 *   • Order feed     — every attempt with its result; new results fire a
 *                     browser notification while this page is open
 *   • Checkout profile — zero-knowledge card encryption (never readable here)
 *
 * Architecture: this page is the brain, the machines are the arms. Detection
 * and checkout run on the home machines (real Chrome, residential/proxy egress,
 * paid with the card saved in the Target wallet — card data never touches
 * this platform). Supabase's bot_orders/bot_config/watchlist tables are the
 * queue between them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  RefreshCw,
  Loader2,
  ShoppingCart,
  ShieldCheck,
  ShieldOff,
  ExternalLink,
  Zap,
  CalendarPlus,
  CreditCard,
  Search,
  Radar,
  Bell,
  BellRing,
  Clock,
  PackagePlus,
} from "lucide-react";

/* ---- zero-knowledge profile encryption (runs entirely in this browser) ----
 * The card is encrypted with the machine's RSA public key BEFORE it leaves
 * this page. Supabase only ever stores ciphertext; only the bot machine can
 * read it. RSA-OAEP SHA-256, chunked (the JSON is ~500 bytes, one RSA block
 * maxes at 190), matching openssl pkeyutl on the bot side. */
async function pemToCryptoKey(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}

async function encryptForMini(pem: string, obj: unknown): Promise<string> {
  const key = await pemToCryptoKey(pem);
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const chunks: string[] = [];
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const ct = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, bytes.slice(i, i + CHUNK));
    const arr = new Uint8Array(ct);
    let bin = "";
    for (let j = 0; j < arr.length; j++) bin += String.fromCharCode(arr[j]);
    chunks.push(btoa(bin));
  }
  return chunks.join("\n");
}

type BotConfig = {
  armed: boolean;
  agentHeartbeat: string | null;
  agentVersion: string | null;
  agentMachine: string | null;
  agentProfileReady?: boolean;
};

type BotOrder = {
  id: string;
  tcin: string;
  productName: string;
  retailer: string;
  status: "queued" | "running" | "ordered" | "failed" | "cancelled";
  source: "auto" | "manual";
  price: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Target = { tcin: string; name: string; msrp: number | null; autoBuy: boolean; imageUrl?: string | null; url?: string | null };

type ProfileInfo = { pubkey: string | null; masked: string | null; pending: boolean; updatedAt: string | null };

type ProfileForm = {
  full_name: string; email: string; phone: string;
  address_line1: string; address_line2: string; city: string; state: string;
  postal_code: string; country: string;
  card_number: string; exp_month: string; exp_year: string; cvv: string;
};

const EMPTY_PROFILE: ProfileForm = {
  full_name: "", email: "", phone: "",
  address_line1: "", address_line2: "", city: "", state: "",
  postal_code: "", country: "US",
  card_number: "", exp_month: "", exp_year: "", cvv: "",
};

type DropWindow = { start: string; end: string; intervalSec: number };

type Snapshot = {
  config: (BotConfig & { dropWindows?: DropWindow[] }) | null;
  agentOnline: boolean;
  activeWindow: DropWindow | null;
  orders: BotOrder[];
  targets: Target[];
  targetsWarning: string | null;
  bots?: Array<{ id: number; machine: string | null; heartbeat: string | null; online: boolean; profileReady: boolean; version: string | null }>;
};

/* ---- add-any-product flow ---- */
type ResolvedProduct = {
  tcin: string;
  name: string | null;
  price: number | null;
  imageUrl: string | null;
  availability: "in-stock" | "out-of-stock" | "preorder" | "unknown" | null;
  url: string;
  source: "redsky" | "product-page" | "unresolved";
};

/* ---- drops radar ---- */
type RadarProduct = { tcin: number; name: string; msrp: number | null; url: string; tracked: boolean };
type RadarEvent = {
  id: string;
  title: string;
  retailer: string;
  type: "street-date" | "overnight-restock" | "drawing" | "invite" | "queue";
  dropsAt: string;
  window: string | null;
  confidence: "confirmed" | "expected" | "rumored";
  note: string;
  sourceUrl: string | null;
  products: RadarProduct[];
  externalProducts: Array<{ name: string; msrp: number | null; url: string | null }>;
};

const DROP_TYPE_BADGE: Record<RadarEvent["type"], { label: string; cls: string }> = {
  "street-date": { label: "STREET DATE", cls: "bg-blue-950/70 text-blue-300 border-blue-800/60" },
  "overnight-restock": { label: "OVERNIGHT RESTOCK", cls: "bg-purple-950/70 text-purple-300 border-purple-800/60" },
  "drawing": { label: "DRAWING", cls: "bg-yellow-950/70 text-yellow-300 border-yellow-800/60" },
  "invite": { label: "INVITE", cls: "bg-orange-950/70 text-orange-300 border-orange-800/60" },
  "queue": { label: "QUEUE", cls: "bg-green-950/70 text-green-300 border-green-800/60" },
};

const AVAILABILITY_BADGE: Record<Exclude<ResolvedProduct["availability"], null>, { label: string; cls: string }> = {
  "in-stock": { label: "IN STOCK", cls: "bg-green-950/60 text-green-300 border-green-800/60" },
  "preorder": { label: "PREORDER", cls: "bg-blue-950/60 text-blue-300 border-blue-800/60" },
  "out-of-stock": { label: "OUT OF STOCK", cls: "bg-red-950/60 text-red-300 border-red-800/60" },
  "unknown": { label: "UNKNOWN", cls: "bg-gray-800 text-gray-400 border-gray-700" },
};

const STATUS_CHIP: Record<BotOrder["status"], string> = {
  queued: "bg-yellow-950/60 text-yellow-300 border-yellow-800/60",
  running: "bg-blue-950/60 text-blue-300 border-blue-800/60",
  ordered: "bg-green-950/60 text-green-300 border-green-800/60",
  failed: "bg-red-950/60 text-red-300 border-red-800/60",
  cancelled: "bg-gray-800 text-gray-400 border-gray-700",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "in 3d 4h" / "in 12m" / "in 45s" — for upcoming drop moments. */
function countdownTo(iso: string, nowMs: number): string {
  const ms = new Date(iso).getTime() - nowMs;
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${sec}s`;
  return `in ${sec}s`;
}

export default function BotPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTcin, setBusyTcin] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [winStart, setWinStart] = useState("");
  const [winEnd, setWinEnd] = useState("");
  const [winInterval, setWinInterval] = useState(15);
  const [winBusy, setWinBusy] = useState(false);
  const [profileInfo, setProfileInfo] = useState<ProfileInfo | null>(null);
  const [profileBot, setProfileBot] = useState(1);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  /* live clock for countdowns */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ---- add-any-product flow state ---- */
  const [addInput, setAddInput] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addPreview, setAddPreview] = useState<ResolvedProduct | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [addName, setAddName] = useState("");
  const [addCap, setAddCap] = useState("");
  const [addAutoBuy, setAddAutoBuy] = useState(true);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /* ---- drops radar state ---- */
  const [events, setEvents] = useState<RadarEvent[] | null>(null);

  /* ---- notifications ---- */
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const seenOrderIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
  }, []);
  const enableNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotifPerm(p);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [res, pRes] = await Promise.all([
        fetch("/api/bot", { cache: "no-store" }),
        fetch(`/api/bot/profile?bot=${profileBot}`, { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSnap(data);
      setError(null);
      if (pRes.ok) setProfileInfo(await pRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bot state");
    } finally {
      setRefreshing(false);
    }
  }, [profileBot]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // live-ish: heartbeat window is 2 min
    return () => clearInterval(t);
  }, [load]);

  /* ---- drops radar: load + refresh every minute ---- */
  useEffect(() => {
    let cancelled = false;
    const fetchEvents = async () => {
      try {
        const res = await fetch("/api/drop-events", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setEvents(Array.isArray(data?.events) ? data.events : []);
      } catch {
        /* radar is optional — leave the last good list */
      }
    };
    fetchEvents();
    const t = setInterval(fetchEvents, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  /* ---- browser notifications for new order results ---- */
  useEffect(() => {
    const orders = snap?.orders ?? [];
    if (orders.length === 0) return;
    if (seenOrderIds.current === null) {
      // first load after a page open: mark everything seen, no spam
      seenOrderIds.current = new Set(orders.map(o => o.id));
      return;
    }
    const fresh = orders.filter(o => !seenOrderIds.current!.has(o.id));
    if (fresh.length > 0) {
      seenOrderIds.current = new Set(orders.map(o => o.id));
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const o of fresh.slice(0, 3)) {
          try {
            new Notification(
              o.status === "ordered" ? "✅ Order placed" : `⚠️ ${o.status}`,
              { body: `${o.productName || `TCIN ${o.tcin}`} · ${o.source === "auto" ? "auto" : "manual"}` },
            );
          } catch { /* notification API unavailable — ignore */ }
        }
      }
    }
  }, [snap?.orders]);

  const stats = useMemo(() => {
    const orders = snap?.orders ?? [];
    return {
      ordered: orders.filter(o => o.status === "ordered").length,
      queued: orders.filter(o => o.status === "queued" || o.status === "running").length,
      failed: orders.filter(o => o.status === "failed").length,
    };
  }, [snap]);

  /* next upcoming drop window (not yet started) */
  const nextWindow = useMemo(() => {
    const windows = snap?.config?.dropWindows ?? [];
    const upcoming = windows
      .map(w => ({ ...w, startMs: new Date(w.start).getTime() }))
      .filter(w => w.startMs > nowMs)
      .sort((a, b) => a.startMs - b.startMs);
    return upcoming[0] ?? null;
  }, [snap?.config?.dropWindows, nowMs]);

  async function setArmed(armed: boolean) {
    setArming(true);
    try {
      const res = await fetch("/api/bot/armed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ armed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set arm state");
    } finally {
      setArming(false);
    }
  }

  async function toggleAutoBuy(t: Target) {
    setBusyTcin(t.tcin);
    try {
      const res = await fetch("/api/bot/watchlist-auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tcin: t.tcin, autoBuy: !t.autoBuy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle auto-buy");
    } finally {
      setBusyTcin(null);
    }
  }

  /* ---- add-any-product: lookup then arm ---- */
  async function lookupProduct() {
    setAddBusy(true);
    setAddMsg(null);
    setAddNote(null);
    setAddPreview(null);
    try {
      const res = await fetch("/api/bot/resolve-product", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: addInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAddPreview(data.product);
      setAddNote(data.note ?? null);
      setAddName(data.product?.name ?? "");
      setAddCap(data.product?.price != null ? String(data.product.price) : "");
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setAddBusy(false);
    }
  }

  async function addToBot() {
    if (!addPreview) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const res = await fetch("/api/bot/add-target", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tcin: addPreview.tcin,
          name: addName,
          msrp: Number(addCap),
          autoBuy: addAutoBuy,
          imageUrl: addPreview.imageUrl,
          url: addPreview.url,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAddMsg(data.updated
        ? `Updated ${addName} — cap $${Number(addCap).toFixed(2)}, auto-buy ${addAutoBuy ? "ON" : "off"}`
        : `Armed ${addName} — cap $${Number(addCap).toFixed(2)}, auto-buy ${addAutoBuy ? "ON" : "off"}. The bot picks it up on its next sync.`);
      setAddInput("");
      setAddPreview(null);
      setAddNote(null);
      await load();
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  /* arm a product straight from the drops radar */
  async function armRadarProduct(p: RadarProduct) {
    if (p.msrp == null) {
      // no price cap known — route through the add form with the TCIN prefilled
      setAddInput(String(p.tcin));
      setAddMsg(`Price cap unknown for ${p.name} — look it up below and set the cap yourself.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusyTcin(String(p.tcin));
    try {
      const res = await fetch("/api/bot/add-target", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tcin: p.tcin, name: p.name, msrp: p.msrp, autoBuy: true, url: p.url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setAddMsg(`Armed ${p.name} (cap $${p.msrp.toFixed(2)}) — auto-buy ON.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to arm product");
    } finally {
      setBusyTcin(null);
    }
  }

  async function saveWindows(windows: DropWindow[]) {
    setWinBusy(true);
    try {
      const res = await fetch("/api/bot/drop-windows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ windows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save drop windows");
    } finally {
      setWinBusy(false);
    }
  }

  function addWindow() {
    if (!winStart || !winEnd) {
      setError("Pick both a start and end time for the drop window");
      return;
    }
    const windows = [...(snap?.config?.dropWindows ?? []), { start: winStart, end: winEnd, intervalSec: winInterval }];
    saveWindows(windows);
    setWinStart("");
    setWinEnd("");
  }

  function removeWindow(i: number) {
    const windows = (snap?.config?.dropWindows ?? []).filter((_, idx) => idx !== i);
    saveWindows(windows);
  }

  async function saveProfile() {
    const f = profileForm;
    if (!f.card_number || !f.exp_month || !f.exp_year || !f.cvv || !f.full_name) {
      setProfileMsg("Name, card number, expiry and CVV are required");
      return;
    }
    if (!profileInfo?.pubkey) {
      setProfileMsg("The bot hasn't published its key yet — let it run once, then retry");
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const ciphertext = await encryptForMini(profileInfo.pubkey, f);
      const res = await fetch(`/api/bot/profile?bot=${profileBot}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ciphertext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setProfileForm({ ...EMPTY_PROFILE, country: f.country });
      setShowProfileForm(false);
      setProfileMsg("Encrypted and queued — the bot picks it up within a few seconds");
      await load();
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : "Failed to encrypt/send profile");
    } finally {
      setSavingProfile(false);
    }
  }

  async function buyNow(t: Target) {
    setBusyTcin(t.tcin);
    try {
      const res = await fetch("/api/bot/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tcin: t.tcin, productName: t.name, price: t.msrp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue order");
    } finally {
      setBusyTcin(null);
    }
  }

  const online = snap?.agentOnline ?? false;
  const armed = snap?.config?.armed ?? false;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot size={22} className="text-yellow-400" /> Buy Bot
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Mission control — arm the machines, watch the drops, catch the products.
          </p>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {notifPerm !== "granted" && (
            <button
              onClick={enableNotifications}
              title="Get a browser notification the moment an order result lands"
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <Bell size={13} /> Notify me
            </button>
          )}
          {notifPerm === "granted" && (
            <span className="flex items-center gap-1 text-[11px] text-green-400" title="Browser notifications on for new order results">
              <BellRing size={12} /> alerts on
            </span>
          )}
          <button
            onClick={load}
            disabled={refreshing}
            className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* status strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Bot Agents</div>
          {(snap?.bots ?? []).length > 0 ? (
            <div className="mt-1.5 space-y-1.5">
              {(snap?.bots ?? []).map((b) => (
                <div key={b.id}>
                  <div className={`flex items-center gap-2 text-sm font-semibold ${b.online ? "text-green-400" : "text-red-400"}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${b.online ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
                    #{b.id} {b.online ? "Online" : "Offline"}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {b.machine ?? "no heartbeat yet"} · {timeAgo(b.heartbeat)}
                    {b.profileReady
                      ? <span className="text-green-400"> · 💳 profile ready</span>
                      : <span className="text-gray-600"> · 💳 no profile</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1.5">
              <div className={`flex items-center gap-2 text-sm font-semibold ${online ? "text-green-400" : "text-red-400"}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${online ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
                {online ? "Online" : "Offline"}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {snap?.config?.agentMachine ?? "no heartbeat yet"} · {timeAgo(snap?.config?.agentHeartbeat ?? null)}
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Master Arm</div>
          <button
            onClick={() => setArmed(!armed)}
            disabled={arming}
            className={`mt-1.5 w-full flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border transition-colors ${
              armed
                ? "bg-green-950/60 text-green-300 border-green-800/60 hover:bg-green-900/60"
                : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
            }`}
          >
            {arming ? <Loader2 size={14} className="animate-spin" /> : armed ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
            {armed ? "ARMED — auto-buying" : "DISARMED"}
          </button>
          <div className="text-[11px] text-gray-500 mt-1">Off = watching only, no purchases</div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
            <Clock size={11} /> Next Fast-Poll Window
          </div>
          {snap?.activeWindow ? (
            <div className="mt-1.5">
              <div className="text-sm font-bold text-green-300 flex items-center gap-1.5">
                <Zap size={13} className="animate-pulse" /> LIVE — every {snap.activeWindow.intervalSec}s
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                until {new Date(snap.activeWindow.end).toLocaleTimeString()}
              </div>
            </div>
          ) : nextWindow ? (
            <div className="mt-1.5">
              <div className="text-lg font-bold text-white tabular-nums">{countdownTo(nextWindow.start, nowMs)}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {new Date(nextWindow.start).toLocaleString()} → {new Date(nextWindow.end).toLocaleTimeString()} · {nextWindow.intervalSec}s polls
              </div>
            </div>
          ) : (
            <div className="mt-1.5">
              <div className="text-sm text-gray-400">none scheduled</div>
              <div className="text-[11px] text-gray-500 mt-0.5">safe cadence ~75–105s around the clock</div>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Orders</div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
            <div>
              <div className="text-lg font-bold text-green-400">{stats.ordered}</div>
              <div className="text-[10px] text-gray-500">ordered</div>
            </div>
            <div>
              <div className="text-lg font-bold text-yellow-400">{stats.queued}</div>
              <div className="text-[10px] text-gray-500">queued</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-400">{stats.failed}</div>
              <div className="text-[10px] text-gray-500">failed</div>
            </div>
          </div>
        </div>
      </div>

      {/* add any Target product */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
          <PackagePlus size={13} /> Add Any Target Product
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Paste any target.com product link (…/A-12345678) or a TCIN"
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && addInput.trim()) lookupProduct(); }}
              className="flex-1 bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500 focus:outline-none focus:border-yellow-600"
            />
            <button
              onClick={lookupProduct}
              disabled={addBusy || !addInput.trim()}
              className="flex-shrink-0 flex items-center justify-center gap-1.5 bg-yellow-950/60 hover:bg-yellow-900/60 disabled:opacity-50 text-yellow-300 border border-yellow-800/60 text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {addBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Look up
            </button>
          </div>

          {addMsg && <div className="text-[12px] text-green-300">{addMsg}</div>}
          {addNote && <div className="text-[11px] text-yellow-300/80">{addNote}</div>}

          {addPreview && (
            <div className="border border-gray-800 rounded-xl bg-gray-950/60 p-3 space-y-3">
              <div className="flex items-start gap-3">
                {addPreview.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={addPreview.imageUrl} alt="" className="w-14 h-14 object-cover rounded-lg bg-gray-800 flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-600 text-[10px]">no img</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {addPreview.availability ? (
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${AVAILABILITY_BADGE[addPreview.availability].cls}`}>
                        {AVAILABILITY_BADGE[addPreview.availability].label}
                      </span>
                    ) : null}
                    <span className="text-[10px] text-gray-500">TCIN {addPreview.tcin}</span>
                  </div>
                  <a
                    href={addPreview.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white text-sm font-medium mt-1 block truncate hover:text-yellow-300"
                  >
                    {addPreview.name ?? "Unknown product — type a name below"} <ExternalLink size={11} className="inline -mt-0.5" />
                  </a>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 block mb-1">
                    Name {addPreview.name ? "(editable)" : "(required — lookup was blocked)"}
                  </label>
                  <input
                    type="text"
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    placeholder="Product name for the bot's logs"
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-gray-500 block mb-1">
                    Price cap $ — the bot NEVER buys above this
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={addCap}
                    onChange={e => setAddCap(e.target.value)}
                    placeholder="e.g. 59.99"
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
                  <button
                    onClick={() => setAddAutoBuy(v => !v)}
                    role="switch"
                    aria-checked={addAutoBuy}
                    className={`relative w-10 h-[22px] rounded-full transition-colors ${addAutoBuy ? "bg-green-600" : "bg-gray-700"}`}
                  >
                    <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${addAutoBuy ? "left-[21px]" : "left-[3px]"}`} />
                  </button>
                  Auto-buy {addAutoBuy ? "ON — bot buys it when it drops" : "off — alerts only"}
                </label>
                <button
                  onClick={addToBot}
                  disabled={adding || !addName.trim() || !(Number(addCap) > 0)}
                  className="flex items-center gap-1.5 bg-green-950/60 hover:bg-green-900/60 disabled:opacity-50 text-green-300 border border-green-800/60 text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  {adding ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Add to bot
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* drops radar */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
          <Radar size={13} /> Drops Radar
          <span className="text-gray-600 font-normal normal-case tracking-normal">— what&#39;s coming, what type of drop it is, and how to play it</span>
        </h2>
        {events === null && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-gray-500 text-sm">Loading the drop calendar…</div>
        )}
        {events !== null && events.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-gray-500 text-sm">
            No upcoming drops on the calendar right now — the next scheduled street date gets added here as soon as it&#39;s confirmed.
          </div>
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {(events ?? []).map(ev => {
            const badge = DROP_TYPE_BADGE[ev.type];
            const dropMs = new Date(ev.dropsAt).getTime();
            const live = dropMs <= nowMs;
            return (
              <div key={ev.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                      <span className="text-[10px] text-gray-500">{ev.retailer}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ev.confidence === "confirmed" ? "text-green-400" : ev.confidence === "expected" ? "text-yellow-400" : "text-gray-500"}`}>
                        {ev.confidence}
                      </span>
                    </div>
                    <div className="text-white text-sm font-semibold mt-1">{ev.title}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold tabular-nums ${live ? "text-green-300" : "text-yellow-300"}`}>
                      {live ? "LIVE / past" : countdownTo(ev.dropsAt, nowMs)}
                    </div>
                    <div className="text-[10px] text-gray-500">{new Date(ev.dropsAt).toLocaleString()}</div>
                  </div>
                </div>
                {ev.window && <div className="text-[11px] text-gray-400">{ev.window}</div>}
                <p className="text-[11px] text-gray-500 leading-relaxed">{ev.note}</p>
                {ev.products.length > 0 && (
                  <div className="space-y-1 border-t border-gray-800/70 pt-2">
                    {ev.products.map(p => (
                      <div key={p.tcin} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-[12px] text-gray-300 hover:text-yellow-300 truncate block">
                            {p.name} {p.msrp != null && <span className="text-gray-500">· ${p.msrp.toFixed(2)}</span>}
                          </a>
                        </div>
                        {p.tracked ? (
                          <span className="text-[10px] text-green-400 flex-shrink-0">on watchlist</span>
                        ) : (
                          <button
                            onClick={() => armRadarProduct(p)}
                            disabled={busyTcin === String(p.tcin)}
                            className="flex-shrink-0 text-[11px] font-semibold text-yellow-300 hover:text-yellow-200 px-2 py-1 rounded border border-yellow-800/50 hover:border-yellow-700 disabled:opacity-50"
                          >
                            {busyTcin === String(p.tcin) ? "…" : "Arm to bot"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {ev.externalProducts.length > 0 && (
                  <div className="space-y-1 border-t border-gray-800/70 pt-2">
                    {ev.externalProducts.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <a href={p.url ?? "#"} target={p.url ? "_blank" : undefined} rel="noreferrer" className="text-[12px] text-gray-400 hover:text-yellow-300 truncate">
                        {p.name} {p.msrp != null && <span className="text-gray-600">· ${p.msrp.toFixed(2)}</span>}
                      </a>
                      <ExternalLink size={10} className="text-gray-600 flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
                {ev.sourceUrl && (
                  <a href={ev.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-gray-600 hover:text-gray-400">
                    source <ExternalLink size={9} className="inline -mt-0.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* drop windows */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Fast-Poll Windows</h2>
        {snap?.activeWindow && (
          <div className="bg-green-950/40 border border-green-800/50 rounded-xl px-4 py-3 text-green-300 text-sm flex items-center gap-2">
            <Zap size={14} className="animate-pulse" />
            <span>
              FAST POLLING NOW — every {snap.activeWindow.intervalSec}s until{" "}
              {new Date(snap.activeWindow.end).toLocaleTimeString()} (window {new Date(snap.activeWindow.start).toLocaleTimeString()} → {new Date(snap.activeWindow.end).toLocaleTimeString()})
            </span>
          </div>
        )}
        <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800/70">
          {(snap?.config?.dropWindows ?? []).length === 0 && (
            <div className="px-4 py-3 text-gray-500 text-sm">
              No windows scheduled. Standard cadence (~75–105s) runs around the clock; schedule a window for a known drop and the bot tightens to fast polling inside it.
            </div>
          )}
          {(snap?.config?.dropWindows ?? []).map((w, i) => {
            const past = new Date(w.end).getTime() < Date.now();
            const live = snap?.activeWindow && w.start === snap.activeWindow.start;
            return (
              <div key={`${w.start}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium">
                    {new Date(w.start).toLocaleString()} → {new Date(w.end).toLocaleTimeString()}
                  </div>
                  <div className="text-[11px] mt-0.5">
                    {live ? (
                      <span className="text-green-400">⚡ fast polling every {w.intervalSec}s — active</span>
                    ) : past ? (
                      <span className="text-gray-600">past</span>
                    ) : (
                      <span className="text-gray-500">fast poll every {w.intervalSec}s when it opens · {countdownTo(w.start, nowMs)}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeWindow(i)}
                  className="flex-shrink-0 text-xs font-semibold text-red-400 hover:text-red-300 px-2 py-1 rounded"
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-800/70">
            <label className="text-[11px] text-gray-500">
              from
              <input
                type="datetime-local"
                value={winStart}
                onChange={e => setWinStart(e.target.value)}
                className="ml-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5"
              />
            </label>
            <label className="text-[11px] text-gray-500">
              to
              <input
                type="datetime-local"
                value={winEnd}
                onChange={e => setWinEnd(e.target.value)}
                className="ml-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5"
              />
            </label>
            <label className="text-[11px] text-gray-500">
              poll every
              <input
                type="number"
                min={5}
                max={60}
                value={winInterval}
                onChange={e => setWinInterval(Number(e.target.value) || 15)}
                className="ml-1 w-16 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5"
              />
              s
            </label>
            <button
              onClick={addWindow}
              disabled={winBusy}
              className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              {winBusy ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />} Schedule window
            </button>
          </div>
        </div>
      </div>

      {/* targets */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Auto-Buy Targets</h2>
        {snap?.targetsWarning && (
          <div className="bg-yellow-950/40 border border-yellow-800/50 rounded-xl px-4 py-3 text-yellow-300 text-sm">
            {snap.targetsWarning}
          </div>
        )}
        <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800/70">
          {(snap?.targets ?? []).length === 0 && (
            <div className="px-4 py-3 text-gray-500 text-sm">
              Nothing armed yet — paste any Target link above and the bot can hunt it.
            </div>
          )}
          {(snap?.targets ?? []).map(t => (
            <div key={t.tcin} className="flex items-center gap-3 px-4 py-3">
              {t.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.imageUrl} alt="" className="w-10 h-10 object-cover rounded-lg bg-gray-800 flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-600">
                  <ShoppingCart size={14} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate">{t.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  TCIN {t.tcin}{t.msrp != null ? ` · cap $${Number(t.msrp).toFixed(2)}` : ""}
                </div>
              </div>
              <button
                onClick={() => buyNow(t)}
                disabled={busyTcin === t.tcin}
                title="Queue a manual order — the bot buys this now"
                className="flex-shrink-0 flex items-center gap-1 bg-yellow-950/60 hover:bg-yellow-900/60 disabled:opacity-50 text-yellow-300 border border-yellow-800/60 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
              >
                {busyTcin === t.tcin ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Buy now
              </button>
              <button
                onClick={() => toggleAutoBuy(t)}
                disabled={busyTcin === t.tcin}
                role="switch"
                aria-checked={t.autoBuy}
                title={t.autoBuy ? "Bot buys this when it drops" : "Alerts only"}
                className={`flex-shrink-0 relative w-10 h-[22px] rounded-full transition-colors ${
                  t.autoBuy ? "bg-green-600" : "bg-gray-700"
                } ${busyTcin === t.tcin ? "opacity-50" : ""}`}
              >
                <span
                  className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-all ${
                    t.autoBuy ? "left-[21px]" : "left-[3px]"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* order feed */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Order Feed</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800/70">
          {(snap?.orders ?? []).length === 0 && (
            <div className="px-4 py-3 text-gray-500 text-sm">No orders yet. The bot&#39;s first catch will appear here.</div>
          )}
          {(snap?.orders ?? []).map(o => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${STATUS_CHIP[o.status]}`}>
                {o.status}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate">
                  {o.productName || `TCIN ${o.tcin}`}{" "}
                  {o.price != null && <span className="text-gray-400 font-normal">· ${Number(o.price).toFixed(2)}</span>}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {o.source === "auto" ? "🤖 auto-detected" : "👤 manual"} · {timeAgo(o.createdAt)}
                  {o.error ? ` · ${o.error}` : ""}
                </div>
              </div>
              <a
                href={`https://www.target.com/p/-/A-${o.tcin}`}
                target="_blank"
                rel="noreferrer"
                className="flex-shrink-0 text-gray-500 hover:text-gray-300"
                title="Open product page"
              >
                <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* checkout profile */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Checkout Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white text-sm font-medium">
                <CreditCard size={14} className="text-yellow-400" />
                {(snap?.bots ?? []).length > 1 && (
                  <select
                    value={profileBot}
                    onChange={(e) => {
                      // drop the other bot's pubkey immediately so a fast Send
                      // click can never encrypt to the wrong bot's key
                      setProfileInfo(null);
                      setProfileBot(Number(e.target.value));
                    }}
                    className="bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 px-2 py-1"
                    aria-label="Send profile to bot"
                  >
                    {(snap?.bots ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        Bot #{b.id} — {b.machine ?? "not connected yet"}
                      </option>
                    ))}
                  </select>
                )}
                {profileInfo?.masked ? (
                  <span>{profileInfo.masked}</span>
                ) : profileInfo?.pending ? (
                  <span className="text-yellow-300">encrypted profile queued — waiting for the bot to pick it up</span>
                ) : (
                  <span className="text-gray-500">no checkout profile on bot #{profileBot} yet</span>
                )}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Zero-knowledge: this page encrypts your card with the bot machine&#39;s own key before anything is sent — the platform
                only ever stores unreadable ciphertext.
              </div>
            </div>
            <button
              onClick={() => setShowProfileForm(v => !v)}
              className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              {showProfileForm ? "Cancel" : "Send profile"}
            </button>
          </div>
          {profileMsg && <div className="mt-2 text-[11px] text-yellow-300">{profileMsg}</div>}
          {showProfileForm && (
            <div className="mt-3 border-t border-gray-800/70 pt-3 space-y-2">
              {!profileInfo?.pubkey && (
                <div className="text-[11px] text-red-300">
                  The bot hasn&#39;t published its encryption key yet — start the bot (install + login steps) and refresh.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  ["full_name", "Name on card", "text"],
                  ["email", "Email", "email"],
                  ["phone", "Phone", "tel"],
                  ["card_number", "Card number", "text"],
                ] as const).map(([k, label, type]) => (
                  <input
                    key={k}
                    type={type}
                    placeholder={label}
                    value={profileForm[k]}
                    onChange={e => setProfileForm(f => ({ ...f, [k]: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                ))}
                <div className="grid grid-cols-3 gap-2">
                  <input
                    placeholder="MM"
                    value={profileForm.exp_month}
                    onChange={e => setProfileForm(f => ({ ...f, exp_month: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                  <input
                    placeholder="YYYY"
                    value={profileForm.exp_year}
                    onChange={e => setProfileForm(f => ({ ...f, exp_year: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                  <input
                    placeholder="CVV"
                    value={profileForm.cvv}
                    onChange={e => setProfileForm(f => ({ ...f, cvv: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                </div>
                <input
                  placeholder="Address line 1"
                  value={profileForm.address_line1}
                  onChange={e => setProfileForm(f => ({ ...f, address_line1: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                />
                <input
                  placeholder="Address line 2"
                  value={profileForm.address_line2}
                  onChange={e => setProfileForm(f => ({ ...f, address_line2: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                />
                <input
                  placeholder="City"
                  value={profileForm.city}
                  onChange={e => setProfileForm(f => ({ ...f, city: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    placeholder="State"
                    value={profileForm.state}
                    onChange={e => setProfileForm(f => ({ ...f, state: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                  <input
                    placeholder="ZIP"
                    value={profileForm.postal_code}
                    onChange={e => setProfileForm(f => ({ ...f, postal_code: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                  <input
                    placeholder="Country"
                    value={profileForm.country}
                    onChange={e => setProfileForm(f => ({ ...f, country: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 placeholder-gray-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile || !profileInfo?.pubkey}
                  className="flex items-center gap-1.5 bg-yellow-950/60 hover:bg-yellow-900/60 disabled:opacity-50 text-yellow-300 border border-yellow-800/60 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                >
                  {savingProfile ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Encrypt and send
                </button>
                <span className="text-[10px] text-gray-600">Card data is encrypted in this browser and stays unreadable everywhere except the bot machine.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-gray-600 text-[11px] leading-relaxed">
        <ShoppingCart size={11} className="inline -mt-0.5" /> The bot checks out with your logged-in Target session on the
        machines and pays with the card saved in your Target wallet — card data never touches this platform. Arm state is
        re-read by the bot every few seconds, so disarming stops buying almost instantly.
      </p>
    </div>
  );
}
