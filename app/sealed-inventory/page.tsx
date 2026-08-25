"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS } from "@/lib/products";
import { supabase, DbSealedItem, daysSince } from "@/lib/supabase";
import { Archive, RefreshCw, Tag, CheckCircle2, Clock, Undo2, Trash2, X, Sparkles, Loader2 } from "lucide-react";

const FEE_RATE = 0.13;      // 13% marketplace fees
const SEALED_SHIPPING = 8;  // padded box + tracking per unit

const platformColors: Record<string, string> = {
  eBay: "bg-blue-950/60 text-blue-400 border-blue-800/40",
  TCGPlayer: "bg-yellow-950/60 text-yellow-400 border-yellow-800/40",
  Mercari: "bg-pink-950/60 text-pink-400 border-pink-800/40",
};

type FilterType = "all" | "owned" | "listed" | "sold";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const productById = new Map(PRODUCTS.map(p => [p.id, p]));

// Decision engine (lib/verdicts.ts) — real hold/sell calls, computed
// on-demand per lot (cost basis is per-lot, so this can't be a cron like the
// product-page verdicts). Gated behind PERPLEXITY_API_KEY server-side;
// entirely inert client-side until it's configured.
type InvVerdictLabel = "SELL" | "WAIT";
type InvVerdictConfidence = "High" | "Medium" | "Low";
type InvVerdictCitation = { url: string; title?: string };
type InvVerdictRow = { verdict: InvVerdictLabel; confidence: InvVerdictConfidence; reason: string; citations: InvVerdictCitation[] };

function invCitationLabel(c: InvVerdictCitation): string {
  try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

const invVerdictStyles: Record<InvVerdictLabel, { cls: string; chipCls: string; Icon: typeof CheckCircle2 }> = {
  SELL: { cls: "border-green-800/40 bg-green-950/20", chipCls: "bg-green-500/20 border-green-500/60 text-green-300", Icon: Tag },
  WAIT: { cls: "border-yellow-800/40 bg-yellow-950/10", chipCls: "bg-yellow-500/20 border-yellow-500/60 text-yellow-300", Icon: Clock },
};

export default function SealedInventory() {
  const [items, setItems] = useState<DbSealedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listForm, setListForm] = useState<{ id: string; asking: string; platform: string } | null>(null);
  const [soldForm, setSoldForm] = useState<{ id: string; price: string } | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, InvVerdictRow>>({});
  const [verdictEngineConfigured, setVerdictEngineConfigured] = useState<boolean | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const usingSupabase = supabase !== null;

  const load = useCallback(async () => {
    setLoading(true);
    if (supabase) {
      const { data, error } = await supabase
        .from("sealed_inventory")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) setItems(data as DbSealedItem[]);
    }
    setLoading(false);
  }, []);

  // Live market prices from the same sources the tracker uses
  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/sealed-prices");
      const json = await res.json();
      if (res.ok && json.prices) {
        const map: Record<string, number> = {};
        for (const p of json.prices) {
          if (typeof p.market === "number" && p.market > 0) map[p.productId] = p.market;
        }
        setLivePrices(map);
      }
    } catch { /* snapshots keep working */ }
    setRefreshing(false);
  }, []);

  // Decision engine: pull whatever verdicts already exist for owned/listed
  // lots (keyed "inv-<sealed_inventory.id>"), and whether the engine is even
  // configured server-side, so the UI can show an honest state either way.
  const loadVerdicts = useCallback(async () => {
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
        .select("product_id, verdict, confidence, reason, citations")
        .like("product_id", "inv-%");
      if (error || !data) return;
      const map: Record<string, InvVerdictRow> = {};
      for (const row of data) {
        if (row.verdict === "SELL" || row.verdict === "WAIT") {
          map[row.product_id] = { verdict: row.verdict, confidence: row.confidence, reason: row.reason, citations: Array.isArray(row.citations) ? row.citations : [] };
        }
      }
      setVerdicts(map);
    } catch { /* honest "not analyzed yet" state below covers this */ }
  }, []);

  useEffect(() => { load(); refreshPrices(); loadVerdicts(); }, [load, refreshPrices, loadVerdicts]);

  function marketFor(item: DbSealedItem): number | null {
    return livePrices[item.product_id] ?? (item.current_market != null ? Number(item.current_market) : null);
  }

  /** On-demand hold/sell analysis for ONE owned/listed lot — real cost basis
   *  + live market + the same signal set the product-page cron uses. */
  async function analyze(item: DbSealedItem) {
    setAnalyzingId(item.id);
    try {
      // send the lot's fields in the body — sealed_inventory is per-user now,
      // so the shared server route can't re-read it; the client has it already.
      const res = await fetch("/api/verdicts/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          productId: item.product_id,
          productName: item.product_name,
          boughtPrice: Number(item.bought_price),
          qty: item.qty,
          currentMarket: item.current_market != null ? Number(item.current_market) : null,
        }),
      });
      const json = await res.json();
      setVerdictEngineConfigured(Boolean(json.configured));
      if (json.configured && json.result) {
        setVerdicts(prev => ({ ...prev, [`inv-${item.id}`]: json.result }));
      }
    } catch { /* honest "not analyzed" state remains */ }
    setAnalyzingId(null);
  }

  async function listIt() {
    if (!supabase || !listForm) return;
    const asking = parseFloat(listForm.asking);
    if (isNaN(asking) || asking <= 0) return;
    setBusyId(listForm.id);
    await supabase.from("sealed_inventory").update({
      status: "listed",
      platform: listForm.platform,
      asking_price: asking,
      listed_at: new Date().toISOString(),
    }).eq("id", listForm.id);
    setListForm(null);
    await load();
    setBusyId(null);
  }

  async function markSold() {
    if (!supabase || !soldForm) return;
    const price = parseFloat(soldForm.price);
    if (isNaN(price) || price <= 0) return;
    setBusyId(soldForm.id);
    await supabase.from("sealed_inventory").update({
      status: "sold",
      sold_price: price,
      sold_at: new Date().toISOString(),
    }).eq("id", soldForm.id);
    setSoldForm(null);
    await load();
    setBusyId(null);
  }

  async function delist(id: string) {
    if (!supabase) return;
    setBusyId(id);
    await supabase.from("sealed_inventory").update({
      status: "owned", platform: null, asking_price: null, listed_at: null,
    }).eq("id", id);
    await load();
    setBusyId(null);
  }

  async function remove(id: string) {
    if (!supabase) return;
    setBusyId(id);
    await supabase.from("sealed_inventory").delete().eq("id", id);
    await load();
    setBusyId(null);
  }

  const visible = filter === "all" ? items : items.filter(i => i.status === filter);
  const owned = items.filter(i => i.status === "owned");
  const listed = items.filter(i => i.status === "listed");
  const sold = items.filter(i => i.status === "sold");

  const totalUnits = [...owned, ...listed].reduce((s, i) => s + i.qty, 0);
  const totalCost = [...owned, ...listed].reduce((s, i) => s + i.qty * Number(i.bought_price), 0);
  const totalValue = [...owned, ...listed].reduce((s, i) => s + i.qty * (marketFor(i) ?? Number(i.bought_price)), 0);
  const realized = sold.reduce(
    (s, i) => s + i.qty * (Number(i.sold_price ?? 0) * (1 - FEE_RATE) - SEALED_SHIPPING - Number(i.bought_price)), 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Archive size={22} className="text-yellow-400" /> Sealed Inventory
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {totalUnits} units held · {listed.length} listing{listed.length === 1 ? "" : "s"} · {sold.length} sold
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshPrices}
            disabled={refreshing}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 text-xs font-medium px-4 py-2 rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh Prices
          </button>
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            {(["all", "owned", "listed", "sold"] as FilterType[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${filter === f ? "bg-yellow-400 text-gray-900" : "text-gray-400 hover:text-white"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!usingSupabase && (
        <div className="bg-orange-950/40 border border-orange-800/40 text-orange-300 text-xs rounded-lg px-4 py-2.5">
          Supabase is not configured — run supabase/sealed_inventory.sql and set NEXT_PUBLIC_SUPABASE_URL /
          NEXT_PUBLIC_SUPABASE_ANON_KEY to track sealed inventory.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Units Held</div>
          <div className="text-2xl font-bold text-white tabular">{totalUnits}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Total Cost</div>
          <div className="text-2xl font-bold text-white tabular">${fmt(totalCost)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Est. Market Value</div>
          <div className="text-2xl font-bold text-white tabular">${fmt(totalValue)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Realized Profit (sold)</div>
          <div className={`text-2xl font-bold tabular ${realized >= 0 ? "text-green-400" : "text-red-400"}`}>
            {realized >= 0 ? "+" : ""}${fmt(realized)}
          </div>
        </div>
      </div>

      {/* Rows */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm space-y-2">
          <Archive size={28} className="mx-auto mb-2 opacity-40" />
          <p>Nothing here yet.</p>
          <p>
            Buy a box, then hit <span className="text-green-400 font-semibold">Add to Inventory</span> on the{" "}
            <Link href="/" className="text-yellow-400 underline hover:text-yellow-300">Sealed Products</Link> page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(item => {
            const product = productById.get(item.product_id);
            const market = marketFor(item);
            const bought = Number(item.bought_price);
            const isLive = livePrices[item.product_id] != null;
            // per-unit net if sold at market (13% fees + $8 shipping)
            const netPerUnit = market != null ? market * (1 - FEE_RATE) - SEALED_SHIPPING - bought : null;
            const roi = netPerUnit != null && bought > 0 ? (netPerUnit / bought) * 100 : null;
            const soldNet = item.sold_price != null
              ? Number(item.sold_price) * (1 - FEE_RATE) - SEALED_SHIPPING - bought
              : null;

            return (
              <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4 flex-wrap">
                {/* Image */}
                <div className="relative w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
                  {product ? (
                    <Image src={product.imageUrl} alt={item.product_name} fill className="object-contain p-1" sizes="56px" />
                  ) : (
                    <div className="flex items-center justify-center h-full text-xl">📦</div>
                  )}
                </div>

                {/* Name + status */}
                <div className="flex-1 min-w-[180px]">
                  <div className="text-white font-semibold text-sm flex items-center gap-2 flex-wrap">
                    {item.product_name}
                    {item.qty > 1 && <span className="text-yellow-400 text-xs font-bold">×{item.qty}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.status === "owned" && (
                      <span className="flex items-center gap-1 text-gray-400 text-xs"><Archive size={11} /> Owned</span>
                    )}
                    {item.status === "listed" && (
                      <>
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <Clock size={11} /> Listed {daysSince(item.listed_at)}d
                        </span>
                        {item.platform && (
                          <span className={`text-[11px] font-medium border rounded-md px-2 py-0.5 ${platformColors[item.platform] ?? "bg-gray-800 text-gray-400 border-gray-700"}`}>
                            {item.platform}
                          </span>
                        )}
                        {item.asking_price != null && (
                          <span className="text-gray-500 text-xs tabular">asking ${fmt(Number(item.asking_price))}</span>
                        )}
                      </>
                    )}
                    {item.status === "sold" && (
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <CheckCircle2 size={11} /> Sold {item.sold_price != null ? `$${fmt(Number(item.sold_price))}/unit` : ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* Numbers */}
                <div className="flex gap-6 text-right flex-wrap">
                  <div>
                    <div className="text-gray-500 text-[11px]">Paid / unit</div>
                    <div className="text-white text-sm tabular font-medium">${fmt(bought)}</div>
                  </div>
                  {item.status !== "sold" ? (
                    <>
                      <div>
                        <div className="text-gray-500 text-[11px]">Market{isLive ? " · live" : ""}</div>
                        <div className="text-white text-sm tabular font-medium">{market != null ? `$${fmt(market)}` : "—"}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-[11px]">Net / unit if sold</div>
                        <div className={`text-sm tabular font-medium ${netPerUnit != null && netPerUnit > 0 ? "text-green-400" : "text-gray-400"}`}>
                          {netPerUnit != null ? `${netPerUnit >= 0 ? "+" : ""}$${fmt(netPerUnit)}` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-[11px]">ROI</div>
                        <div className={`text-sm tabular font-medium ${roi != null && roi > 30 ? "text-green-400" : roi != null && roi >= 10 ? "text-yellow-400" : "text-gray-400"}`}>
                          {roi != null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <div className="text-gray-500 text-[11px]">Realized / unit</div>
                      <div className={`text-sm tabular font-bold ${soldNet != null && soldNet >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {soldNet != null ? `${soldNet >= 0 ? "+" : ""}$${fmt(soldNet)}` : "—"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 ml-auto">
                  {item.status !== "sold" && (() => {
                    const v = verdicts[`inv-${item.id}`];
                    const isAnalyzing = analyzingId === item.id;
                    if (v) {
                      const { chipCls, Icon } = invVerdictStyles[v.verdict];
                      return (
                        <span className="flex flex-col items-end gap-1">
                          <span
                            title={v.reason}
                            className={`flex items-center gap-1.5 border text-xs font-extrabold px-2.5 py-1.5 rounded-lg cursor-help ${chipCls}`}
                          >
                            <Icon size={12} /> {v.verdict} · {v.confidence}
                          </span>
                          {v.citations.length > 0 && (
                            <span className="flex items-center gap-1.5 flex-wrap justify-end">
                              {v.citations.slice(0, 3).map((c, i) => (
                                <a
                                  key={c.url}
                                  href={c.url}
                                  target="_blank" rel="noopener noreferrer"
                                  title={c.title ?? c.url}
                                  className="text-[10px] text-gray-500 hover:text-yellow-400 underline decoration-gray-700 underline-offset-2 transition-colors"
                                >
                                  [{i + 1}] {invCitationLabel(c)}
                                </a>
                              ))}
                            </span>
                          )}
                        </span>
                      );
                    }
                    return (
                      <button
                        onClick={() => analyze(item)}
                        disabled={isAnalyzing}
                        title={verdictEngineConfigured === false ? "Decision engine not enabled yet (PERPLEXITY_API_KEY not set)" : "Analyze real cost basis + live market data for a hold/sell verdict"}
                        className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-teal-700/50 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {isAnalyzing ? "Analyzing…" : "Analyze"}
                      </button>
                    );
                  })()}
                  {usingSupabase && item.status === "owned" && (
                    <button
                      onClick={() => setListForm({ id: item.id, asking: market != null ? String(Math.round(market)) : "", platform: "eBay" })}
                      disabled={busyId === item.id}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 bg-yellow-400 hover:bg-yellow-300 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      <Tag size={12} /> List It
                    </button>
                  )}
                  {usingSupabase && item.status === "listed" && (
                    <>
                      <button
                        onClick={() => setSoldForm({ id: item.id, price: item.asking_price != null ? String(Number(item.asking_price)) : "" })}
                        disabled={busyId === item.id}
                        className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-green-400 border border-gray-700 hover:border-green-700/50 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 size={12} /> Mark Sold
                      </button>
                      <button
                        onClick={() => delist(item.id)}
                        disabled={busyId === item.id}
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-yellow-400 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
                      >
                        <Undo2 size={12} /> Delist
                      </button>
                    </>
                  )}
                  {usingSupabase && (
                    <button
                      onClick={() => remove(item.id)}
                      disabled={busyId === item.id}
                      title="Remove entry"
                      className="w-8 h-8 rounded-lg bg-red-950/60 border border-red-800/50 text-red-400 hover:bg-red-900 flex items-center justify-center transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* Inline forms */}
                {listForm?.id === item.id && (
                  <div className="w-full flex items-end gap-3 flex-wrap bg-gray-950/60 border border-yellow-400/20 rounded-lg p-3">
                    <div>
                      <div className="text-gray-500 text-[11px] mb-1">Asking $ / unit</div>
                      <input
                        type="number" min="0" step="0.01" autoFocus
                        value={listForm.asking}
                        onChange={e => setListForm({ ...listForm, asking: e.target.value })}
                        className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white tabular focus:outline-none focus:border-yellow-400/50"
                      />
                    </div>
                    <div>
                      <div className="text-gray-500 text-[11px] mb-1">Platform</div>
                      <select
                        value={listForm.platform}
                        onChange={e => setListForm({ ...listForm, platform: e.target.value })}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                      >
                        {["eBay", "TCGPlayer", "Mercari"].map(p => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                    <button onClick={listIt} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                      Confirm Listing
                    </button>
                    <button onClick={() => setListForm(null)} className="text-gray-500 hover:text-white p-1"><X size={14} /></button>
                  </div>
                )}
                {soldForm?.id === item.id && (
                  <div className="w-full flex items-end gap-3 flex-wrap bg-gray-950/60 border border-green-700/30 rounded-lg p-3">
                    <div>
                      <div className="text-gray-500 text-[11px] mb-1">Sold $ / unit</div>
                      <input
                        type="number" min="0" step="0.01" autoFocus
                        value={soldForm.price}
                        onChange={e => setSoldForm({ ...soldForm, price: e.target.value })}
                        className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white tabular focus:outline-none focus:border-green-500/50"
                      />
                    </div>
                    <button onClick={markSold} className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                      Confirm Sale
                    </button>
                    <button onClick={() => setSoldForm(null)} className="text-gray-500 hover:text-white p-1"><X size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
