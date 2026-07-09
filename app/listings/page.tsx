"use client";
import { useState, useEffect, useCallback } from "react";
import { listings as mockListings } from "@/lib/data";
import { supabase, DbCard, daysSince } from "@/lib/supabase";
import { AlertTriangle, CheckCircle2, Clock, Undo2 } from "lucide-react";

type Listing = {
  id: string | number;
  name: string;
  platform: string;
  asking: number;
  cost: number;
  daysListed: number;
  watchers: number;
  status: "active" | "sold";
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(cost: number, asking: number) {
  const fees = asking * 0.13;
  const profit = asking - fees - cost;
  return cost > 0 ? ((profit / cost) * 100).toFixed(1) : "0.0";
}
function estProfit(cost: number, asking: number) {
  const fees = asking * 0.13;
  return asking - fees - cost;
}

const platformColors: Record<string, string> = {
  eBay: "bg-blue-950/60 text-blue-400 border-blue-800/40",
  TCGPlayer: "bg-yellow-950/60 text-yellow-400 border-yellow-800/40",
  Mercari: "bg-pink-950/60 text-pink-400 border-pink-800/40",
};

type FilterType = "all" | "active" | "sold";

export default function Listings() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [listings, setListings] = useState<Listing[]>([]);
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const usingSupabase = supabase !== null;

  const load = useCallback(async () => {
    if (supabase) {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .in("status", ["active", "sold"])
        .order("listed_at", { ascending: false });
      if (!error && data) {
        setListings((data as DbCard[]).map(r => ({
          id: r.id,
          name: r.condition && r.condition !== "Raw NM" ? `${r.name} ${r.condition}` : r.name,
          platform: r.platform ?? "—",
          asking: Number(r.asking ?? 0),
          cost: Number(r.bought),
          daysListed: daysSince(r.listed_at),
          watchers: r.watchers,
          status: r.status as "active" | "sold",
        })));
        return;
      }
    }
    setListings(mockListings as Listing[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markSold(id: string | number) {
    if (!supabase) return;
    setBusyId(id);
    await supabase.from("cards").update({ status: "sold" }).eq("id", id);
    await load();
    setBusyId(null);
  }

  async function relist(id: string | number) {
    if (!supabase) return;
    setBusyId(id);
    await supabase.from("cards").update({ status: "active", listed_at: new Date().toISOString() }).eq("id", id);
    await load();
    setBusyId(null);
  }

  const visible = filter === "all" ? listings : listings.filter(l => l.status === filter);
  const active = listings.filter(l => l.status === "active");
  const sold = listings.filter(l => l.status === "sold");
  const needsReprice = active.filter(l => l.daysListed >= 14);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">{active.length} active · {sold.length} sold · {needsReprice.length} need reprice</p>
        </div>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(["all", "active", "sold"] as FilterType[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${filter === f ? "bg-yellow-400 text-gray-900" : "text-gray-400 hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {!usingSupabase && (
        <div className="bg-orange-950/40 border border-orange-800/40 text-orange-300 text-xs rounded-lg px-4 py-2.5">
          Supabase is not configured — showing demo listings. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and run supabase/schema.sql to enable the database.
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Active Listings</div>
          <div className="text-2xl font-bold text-white tabular">{active.length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Total Asked</div>
          <div className="text-2xl font-bold text-white tabular">${fmt(active.reduce((s, l) => s + l.asking, 0))}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Est. Profit (active)</div>
          <div className="text-2xl font-bold text-green-400 tabular">+${fmt(active.reduce((s, l) => s + estProfit(l.cost, l.asking), 0))}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
            <AlertTriangle size={11} className="text-orange-400" /> Need Reprice
          </div>
          <div className="text-2xl font-bold text-orange-400 tabular">{needsReprice.length}</div>
        </div>
      </div>

      {/* Listings table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-5 py-3 text-xs text-gray-500 border-b border-gray-800 font-medium uppercase tracking-wide">
          <div className="col-span-3">Card</div>
          <div className="col-span-2">Platform</div>
          <div className="col-span-1 text-right">Asking</div>
          <div className="col-span-1 text-right">Est. Profit</div>
          <div className="col-span-1 text-right">Margin</div>
          <div className="col-span-1 text-center">Days</div>
          <div className="col-span-1 text-center">Watchers</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-1 text-center">Actions</div>
        </div>
        <div className="divide-y divide-gray-800">
          {visible.map(listing => {
            const profit = estProfit(listing.cost, listing.asking);
            const marginPct = pct(listing.cost, listing.asking);
            const stale = listing.daysListed >= 14 && listing.status === "active";

            return (
              <div key={listing.id} className={`grid grid-cols-12 gap-4 px-5 py-4 text-sm items-center hover:bg-gray-800/40 transition-colors ${stale ? "bg-orange-950/10" : ""}`}>
                <div className="col-span-3">
                  <div className="font-medium text-white">{listing.name}</div>
                  {stale && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={11} className="text-orange-400" />
                      <span className="text-orange-400 text-xs">Reprice suggested</span>
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <span className={`text-xs font-medium border rounded-md px-2 py-1 ${platformColors[listing.platform] || "bg-gray-800 text-gray-400 border-gray-700"}`}>
                    {listing.platform}
                  </span>
                </div>
                <div className="col-span-1 text-right font-semibold text-white tabular">${fmt(listing.asking)}</div>
                <div className={`col-span-1 text-right font-semibold tabular ${profit > 0 ? "text-green-400" : "text-red-400"}`}>
                  {profit > 0 ? "+" : ""}${fmt(profit)}
                </div>
                <div className={`col-span-1 text-right tabular text-xs font-medium ${parseFloat(marginPct) > 15 ? "text-green-400" : parseFloat(marginPct) > 0 ? "text-yellow-400" : "text-red-400"}`}>
                  {marginPct}%
                </div>
                <div className="col-span-1 text-center">
                  <span className={`text-xs tabular ${stale ? "text-orange-400 font-semibold" : "text-gray-400"}`}>
                    {listing.status === "sold" ? "—" : `${listing.daysListed}d`}
                  </span>
                </div>
                <div className="col-span-1 text-center">
                  <div className="flex items-center justify-center gap-1 text-xs text-gray-400">
                    {listing.watchers > 0 ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                        <span className="tabular">{listing.watchers}</span>
                      </>
                    ) : "—"}
                  </div>
                </div>
                <div className="col-span-1 text-center">
                  {listing.status === "active" ? (
                    <span className="flex items-center justify-center gap-1 text-green-400 text-xs">
                      <Clock size={11} /> Active
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1 text-gray-500 text-xs">
                      <CheckCircle2 size={11} /> Sold
                    </span>
                  )}
                </div>
                <div className="col-span-1 text-center">
                  {usingSupabase && (listing.status === "active" ? (
                    <button
                      onClick={() => markSold(listing.id)}
                      disabled={busyId === listing.id}
                      className="text-xs font-medium text-gray-400 hover:text-green-400 border border-gray-700 hover:border-green-700/50 rounded-md px-2 py-1 transition-colors disabled:opacity-50"
                    >
                      Mark Sold
                    </button>
                  ) : (
                    <button
                      onClick={() => relist(listing.id)}
                      disabled={busyId === listing.id}
                      className="text-xs font-medium text-gray-400 hover:text-yellow-400 border border-gray-700 hover:border-yellow-700/50 rounded-md px-2 py-1 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Undo2 size={10} /> Relist
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="text-center py-12 text-gray-600 text-sm">No listings yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
