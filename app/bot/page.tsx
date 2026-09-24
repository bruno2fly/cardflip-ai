"use client";

/**
 * 🤖 Buy Bot — the DropBot control room.
 *
 * One page to see and steer the auto-buy system:
 *   • Agent status    — is the Mac mini alive (heartbeat < 2 min)?
 *   • Master arm      — the kill switch; off = detection still runs, no buying
 *   • Auto-buy targets— watchlist items with a Target TCIN, each toggleable
 *   • Buy now         — queue a manual order; the bot picks it up in ~3s
 *   • Order feed      — every attempt (auto + manual) with its result
 *
 * Architecture: this page is the brain, the Mac mini is the arm. Detection
 * and checkout run on the mini (Playwright + real Chrome on the home IP,
 * paid with the card saved in the Target wallet — card data never touches
 * this platform). Supabase's bot_orders/bot_config tables are the queue
 * between them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

/* ---- zero-knowledge profile encryption (runs entirely in this browser) ----
 * The card is encrypted with the Mac mini's RSA public key BEFORE it leaves
 * this page. Supabase only ever stores ciphertext; only the mini can read it.
 * RSA-OAEP SHA-256, chunked (the JSON is ~500 bytes, one RSA block maxes at
 * 190), matching openssl pkeyutl on the mini side. */
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

type Target = { tcin: string; name: string; msrp: number | null; autoBuy: boolean };

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
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [res, pRes] = await Promise.all([
        fetch("/api/bot", { cache: "no-store" }),
        fetch("/api/bot/profile", { cache: "no-store" }),
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
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // live-ish: heartbeat window is 2 min
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    const orders = snap?.orders ?? [];
    return {
      ordered: orders.filter(o => o.status === "ordered").length,
      queued: orders.filter(o => o.status === "queued" || o.status === "running").length,
      failed: orders.filter(o => o.status === "failed").length,
    };
  }, [snap]);

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
      const res = await fetch("/api/bot/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ciphertext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setProfileForm({ ...EMPTY_PROFILE, country: f.country });
      setShowProfileForm(false);
      setProfileMsg("Encrypted and queued — the Mac mini picks it up within a few seconds");
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
    <div className="space-y-6 max-w-3xl">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot size={22} className="text-yellow-400" /> Buy Bot
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            The auto-buy arm — detects drops on the Mac mini, checks out with real Chrome, reports back here.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Bot Agent</div>
          <div className={`mt-1.5 flex items-center gap-2 text-sm font-semibold ${online ? "text-green-400" : "text-red-400"}`}>
            <span className={`inline-block w-2 h-2 rounded-full ${online ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {online ? "Online" : "Offline"}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            {snap?.config?.agentMachine ?? "no heartbeat yet"} · {timeAgo(snap?.config?.agentHeartbeat ?? null)}
          </div>
          <div className="text-[11px] mt-0.5">
            {snap?.config?.agentProfileReady ? (
              <span className="text-green-400">💳 checkout profile ready (encrypted, on-device)</span>
            ) : (
              <span className="text-gray-600">💳 no checkout profile on the bot — wallet-only buying</span>
            )}
          </div>
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

      {/* checkout profile */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Checkout Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white text-sm font-medium">
                <CreditCard size={14} className="text-yellow-400" />
                {profileInfo?.masked ? (
                  <span>{profileInfo.masked}</span>
                ) : profileInfo?.pending ? (
                  <span className="text-yellow-300">encrypted profile queued — waiting for the Mac mini to pick it up</span>
                ) : (
                  <span className="text-gray-500">no checkout profile on the bot yet</span>
                )}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Zero-knowledge: this page encrypts your card with the Mac mini&apos;s own key before anything is sent — the platform
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
                  The Mac mini hasn&apos;t published its encryption key yet — start the bot (install + login steps) and refresh.
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
                <span className="text-[10px] text-gray-600">Card data is encrypted in this browser and stays unreadable everywhere except the Mac mini.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* drop windows */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Drop Windows</h2>
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
                      <span className="text-gray-500">fast poll every {w.intervalSec}s when it opens</span>
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
              No watchlist items with a Target TCIN yet — add products from the Target Catalog, then toggle auto-buy here.
            </div>
          )}
          {(snap?.targets ?? []).map(t => (
            <div key={t.tcin} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate">{t.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  TCIN {t.tcin}{t.msrp != null ? ` · MSRP $${Number(t.msrp).toFixed(2)}` : ""}
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
            <div className="px-4 py-3 text-gray-500 text-sm">No orders yet. The bot&apos;s first catch will appear here.</div>
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

      <p className="text-gray-600 text-[11px] leading-relaxed">
        <ShoppingCart size={11} className="inline -mt-0.5" /> The bot checks out with your logged-in Target session on the
        Mac mini and pays with the card saved in your Target wallet — card data never touches this platform. Arm state is
        re-read by the bot every few seconds, so disarming stops buying almost instantly.
      </p>
    </div>
  );
}
