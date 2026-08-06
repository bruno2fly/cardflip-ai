"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { inventory as defaultInventory } from "@/lib/data";
import { supabase, DbCard } from "@/lib/supabase";
import { Plus, Trash2, TrendingUp, TrendingDown, Search, Loader2, X } from "lucide-react";

type Card = {
  id: string | number;
  name: string;
  set: string;
  number: string;
  condition: string;
  bought: number;
  current: number;
  image: string;
  cardImage?: string;
};

type SearchResult = {
  id: string;
  name: string;
  set: { name: string; printedTotal?: number };
  number: string;
  rarity?: string;
  images?: { small?: string; large?: string };
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function fromDb(row: DbCard): Card {
  return {
    id: row.id,
    name: row.name,
    set: row.set_name ?? "",
    number: row.card_number ?? "",
    condition: row.condition,
    bought: Number(row.bought),
    current: Number(row.current),
    image: row.emoji || "🃏",
    cardImage: row.card_image ?? undefined,
  };
}

const conditionColors: Record<string, string> = {
  "PSA 10": "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  "PSA 9": "bg-blue-400/10 text-blue-400 border-blue-400/30",
  "PSA 8": "bg-purple-400/10 text-purple-400 border-purple-400/30",
  "PSA 6": "bg-orange-400/10 text-orange-400 border-orange-400/30",
  "Raw NM": "bg-gray-400/10 text-gray-400 border-gray-400/30",
};

export default function Inventory() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [hoverCard, setHoverCard] = useState<string | number | null>(null);
  const usingSupabase = supabase !== null;

  // --- Pokemon TCG API search state ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [form, setForm] = useState({ condition: "Raw NM", bought: "", current: "" });
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- load inventory (Supabase, falling back to localStorage/mock) ---
  const loadCards = useCallback(async () => {
    setLoading(true);
    if (supabase) {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: true });
      if (!error && data) setCards((data as DbCard[]).map(fromDb));
    } else {
      const stored = localStorage.getItem("cardflip-inventory");
      setCards(stored ? JSON.parse(stored) : defaultInventory);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  function saveLocal(updated: Card[]) {
    setCards(updated);
    localStorage.setItem("cardflip-inventory", JSON.stringify(updated));
  }

  // --- debounced card search against the Pokemon TCG API ---
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setSearching(false); setSearchError(null); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // Server-side proxy so the POKEMONTCG_API_KEY is used — direct
        // browser calls get rate-limited and silently fail in production.
        const q = encodeURIComponent(`name:*${query.trim()}*`);
        const res = await fetch(`/api/search?q=${q}&pageSize=12`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const json = await res.json();
        setResults(json.data ?? []);
        setSearchError(null);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
          setSearchError("Card search failed — try again in a moment.");
        }
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Clicking a result auto-fills name, set, number, cardImage — and pre-fills
  // the current market value from the live prices route.
  async function selectResult(r: SearchResult) {
    setSelected(r);
    setResults([]);
    setQuery("");
    try {
      const res = await fetch(
        `/api/prices?name=${encodeURIComponent(r.name)}&set=${encodeURIComponent(r.set.name)}&number=${encodeURIComponent(r.number)}`
      );
      if (res.ok) {
        const json = await res.json();
        if (json.prices?.market != null) {
          setForm(f => ({ ...f, current: f.current || String(json.prices.market) }));
        }
      }
    } catch { /* price prefill is best-effort */ }
  }

  async function addCard() {
    if (!selected || !form.bought || !form.current) return;
    setSaving(true);
    const displayNumber = selected.set.printedTotal
      ? `${selected.number}/${selected.set.printedTotal}`
      : selected.number;
    const cardImage = selected.images?.large ?? selected.images?.small;

    if (supabase) {
      const { error } = await supabase.from("cards").insert({
        name: selected.name,
        set_name: selected.set.name,
        card_number: displayNumber,
        condition: form.condition,
        bought: parseFloat(form.bought),
        current: parseFloat(form.current),
        card_image: cardImage ?? null,
      });
      if (!error) await loadCards();
    } else {
      const next: Card = {
        id: Date.now(),
        name: selected.name,
        set: selected.set.name,
        number: displayNumber,
        condition: form.condition,
        bought: parseFloat(form.bought),
        current: parseFloat(form.current),
        image: "🃏",
        cardImage,
      };
      saveLocal([...cards, next]);
    }
    setSaving(false);
    setSelected(null);
    setForm({ condition: "Raw NM", bought: "", current: "" });
    setShowForm(false);
  }

  async function deleteCard(id: string | number) {
    if (supabase) {
      const { error } = await supabase.from("cards").delete().eq("id", id);
      if (!error) setCards(cards.filter(c => c.id !== id));
    } else {
      saveLocal(cards.filter(c => c.id !== id));
    }
  }

  const totalValue = cards.reduce((s, c) => s + c.current, 0);
  const totalPL = cards.reduce((s, c) => s + (c.current - c.bought), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventory</h1>
          <p className="text-gray-500 text-sm mt-0.5">{cards.length} cards · Total value ${fmt(totalValue)}</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setSelected(null); setQuery(""); setResults([]); }}
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> Add Card
        </button>
      </div>

      {!usingSupabase && (
        <div className="bg-orange-950/40 border border-orange-800/40 text-orange-300 text-xs rounded-lg px-4 py-2.5">
          Supabase is not configured — using local browser storage. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and run supabase/schema.sql to enable the database.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Total Cards</div>
          <div className="text-2xl font-bold text-white tabular">{cards.length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Portfolio Value</div>
          <div className="text-2xl font-bold text-white tabular">${fmt(totalValue)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs mb-1">Total P&L</div>
          <div className={`text-2xl font-bold tabular ${totalPL >= 0 ? "text-green-400" : "text-red-400"}`}>
            {totalPL >= 0 ? "+" : ""}${fmt(totalPL)}
          </div>
        </div>
      </div>

      {/* Add Card — live Pokemon TCG search */}
      {showForm && (
        <div className="bg-gray-900 border border-yellow-400/20 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Add New Card</h3>

          {!selected && (
            <>
              <div className="relative mb-3">
                {searching
                  ? <Loader2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-yellow-400 animate-spin" />
                  : <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />}
                <input
                  autoFocus
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
                  placeholder="Search the Pokemon TCG database — e.g. Umbreon VMAX"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              {searchError && <p className="text-red-400 text-xs mb-3">{searchError}</p>}

              {results.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-3 max-h-96 overflow-y-auto pr-1">
                  {results.map(r => (
                    <button
                      key={r.id}
                      onClick={() => selectResult(r)}
                      className="group text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-yellow-400/50 rounded-lg p-2 transition-all"
                    >
                      <div className="relative w-full aspect-[2.5/3.5] mb-2 rounded overflow-hidden bg-gray-900">
                        {r.images?.small ? (
                          <Image src={r.images.small} alt={r.name} fill className="object-contain" sizes="120px" />
                        ) : (
                          <div className="flex items-center justify-center h-full text-2xl">🃏</div>
                        )}
                      </div>
                      <div className="text-white text-xs font-medium leading-tight truncate">{r.name}</div>
                      <div className="text-gray-500 text-[11px] truncate">{r.set.name}</div>
                      <div className="text-gray-600 text-[11px]">
                        #{r.set.printedTotal ? `${r.number}/${r.set.printedTotal}` : r.number}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
                <p className="text-gray-500 text-xs mb-3">No cards found for &quot;{query}&quot;</p>
              )}
            </>
          )}

          {/* Selected card → auto-filled details + purchase info */}
          {selected && (
            <div className="flex gap-4 mb-4">
              <div className="relative w-24 h-32 flex-shrink-0 rounded-lg overflow-hidden bg-gray-800">
                {selected.images?.small ? (
                  <Image src={selected.images.small} alt={selected.name} fill className="object-contain" sizes="96px" />
                ) : (
                  <div className="flex items-center justify-center h-full text-3xl">🃏</div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-white font-semibold text-sm">{selected.name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {selected.set.name} · #{selected.set.printedTotal ? `${selected.number}/${selected.set.printedTotal}` : selected.number}
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white p-1">
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}>
                    {["PSA 10", "PSA 9", "PSA 8", "PSA 7", "PSA 6", "Raw NM", "Raw LP"].map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
                    placeholder="Bought ($) *" value={form.bought} onChange={e => setForm({ ...form, bought: e.target.value })} />
                  <input type="number" className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
                    placeholder="Current ($) *" value={form.current} onChange={e => setForm({ ...form, current: e.target.value })} />
                </div>
                <p className="text-gray-600 text-[11px] mt-2">Current value is pre-filled with the live TCGPlayer <strong>Near Mint (raw)</strong> average when available — adjust it for graded copies (PSA/BGS) or lower-condition cards, which price very differently.</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={addCard}
              disabled={!selected || !form.bought || !form.current || saving}
              className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />} Save Card
            </button>
            <button onClick={() => { setShowForm(false); setSelected(null); }} className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg border border-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Card Grid */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
              <div className="w-full aspect-[2.5/3.5] mb-3 rounded-lg bg-gray-800" />
              <div className="h-3 bg-gray-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(card => {
          const pl = card.current - card.bought;
          const plPct = card.bought > 0 ? ((pl / card.bought) * 100).toFixed(1) : "0.0";
          const isHover = hoverCard === card.id;
          return (
            <div
              key={card.id}
              className="relative bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition-all cursor-pointer"
              onMouseEnter={() => setHoverCard(card.id)}
              onMouseLeave={() => setHoverCard(null)}
            >
              {isHover && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCard(card.id); }}
                  className="absolute top-2 right-2 z-10 w-7 h-7 rounded-lg bg-red-950/80 border border-red-800/60 text-red-400 hover:bg-red-900 flex items-center justify-center transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}

              <div className="relative w-full aspect-[2.5/3.5] mb-3 rounded-lg overflow-hidden bg-gray-800">
                {card.cardImage ? (
                  <Image src={card.cardImage} alt={card.name} fill className="object-contain" sizes="200px" />
                ) : (
                  <div className="flex items-center justify-center h-full text-4xl">{card.image}</div>
                )}
              </div>
              <div className="font-semibold text-white text-sm leading-tight mb-1">{card.name}</div>
              <div className="text-gray-500 text-xs mb-1">{card.set}</div>
              {card.number && <div className="text-gray-600 text-xs mb-2">#{card.number}</div>}
              <span className={`inline-block text-xs font-medium border rounded-md px-2 py-0.5 mb-3 ${conditionColors[card.condition] || "bg-gray-700/40 text-gray-400 border-gray-600"}`}>
                {card.condition}
              </span>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Bought</span>
                  <span className="text-white tabular">${fmt(card.bought)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Market</span>
                  <span className="text-white tabular">${fmt(card.current)}</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-gray-800">
                  <span className="text-gray-500">P&L</span>
                  <span className={`tabular flex items-center gap-1 font-medium ${pl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {pl >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {pl >= 0 ? "+" : ""}${fmt(pl)} ({pl >= 0 ? "+" : ""}{plPct}%)
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
