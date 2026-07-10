"use client";
import { useState, useEffect } from "react";
import { Package2, Lightbulb, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from "lucide-react";

const FEE_RATE = 0.13;        // 13% marketplace fees
const SEALED_SHIPPING = 8;    // sealed product ships heavier — padded box + tracking

type ProductType = "ETB" | "Booster Box" | "Booster Bundle" | "Premium Collection" | "Booster Pack";
type Hotness = "🔥 Hot" | "📈 Rising" | "✅ Stable" | "❄️ Cooling";

type SealedProduct = {
  id: string;
  name: string;
  set: string;
  type: ProductType;
  msrp: number;
  tcgplayerUrl: string;
  ebayQuery: string;
  hotness: Hotness;
  notes: string;
};

function tcgUrl(name: string) {
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(name)}&view=grid`;
}

const PRODUCTS: SealedProduct[] = [
  { id: "prismatic-etb", name: "Prismatic Evolutions Elite Trainer Box", set: "Prismatic Evolutions", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Elite Trainer Box"), ebayQuery: "Prismatic Evolutions Elite Trainer Box", hotness: "🔥 Hot", notes: "Selling $150–200+ — most flipped ETB in 2024" },
  { id: "prismatic-bundle", name: "Prismatic Evolutions Booster Bundle", set: "Prismatic Evolutions", type: "Booster Bundle", msrp: 29.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Booster Bundle"), ebayQuery: "Prismatic Evolutions Booster Bundle", hotness: "🔥 Hot", notes: "6 packs, flipping $70–90" },
  { id: "surging-etb", name: "Surging Sparks Elite Trainer Box", set: "Surging Sparks", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Surging Sparks Elite Trainer Box"), ebayQuery: "Surging Sparks Elite Trainer Box", hotness: "📈 Rising", notes: "Recently out of stock at retail" },
  { id: "surging-box", name: "Surging Sparks Booster Box", set: "Surging Sparks", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Surging Sparks Booster Box"), ebayQuery: "Surging Sparks Booster Box", hotness: "📈 Rising", notes: "Trending up as stock dries" },
  { id: "stellar-etb", name: "Stellar Crown Elite Trainer Box", set: "Stellar Crown", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Stellar Crown Elite Trainer Box"), ebayQuery: "Stellar Crown Elite Trainer Box", hotness: "✅ Stable", notes: "Steady $55–65 range" },
  { id: "twilight-etb", name: "Twilight Masquerade Elite Trainer Box", set: "Twilight Masquerade", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Twilight Masquerade Elite Trainer Box"), ebayQuery: "Twilight Masquerade Elite Trainer Box", hotness: "❄️ Cooling", notes: "Was hot, stabilizing $60–70" },
  { id: "paradox-box", name: "Paradox Rift Booster Box", set: "Paradox Rift", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Paradox Rift Booster Box"), ebayQuery: "Paradox Rift Booster Box", hotness: "📈 Rising", notes: "Singles still in demand" },
  { id: "obsidian-etb", name: "Obsidian Flames Elite Trainer Box", set: "Obsidian Flames", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Obsidian Flames Elite Trainer Box"), ebayQuery: "Obsidian Flames Elite Trainer Box", hotness: "📈 Rising", notes: "Charizard set — collectors hold" },
  { id: "151-etb", name: "Pokemon 151 Elite Trainer Box", set: "Pokemon 151", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Pokemon 151 Elite Trainer Box"), ebayQuery: "Pokemon 151 Elite Trainer Box", hotness: "🔥 Hot", notes: "One of best ETBs ever — premium price" },
  { id: "151-box", name: "Pokemon 151 Booster Box", set: "Pokemon 151", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Pokemon 151 Booster Box"), ebayQuery: "Pokemon 151 Booster Box", hotness: "🔥 Hot", notes: "Sealed box fetches $250–400+" },
  { id: "evolving-box", name: "Evolving Skies Booster Box", set: "Evolving Skies", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Evolving Skies Booster Box"), ebayQuery: "Evolving Skies Booster Box", hotness: "🔥 Hot", notes: "Umbreon VMAX set — premium forever" },
  { id: "crown-etb", name: "Crown Zenith Elite Trainer Box", set: "Crown Zenith", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Crown Zenith Elite Trainer Box"), ebayQuery: "Crown Zenith Elite Trainer Box", hotness: "📈 Rising", notes: "Special set, limited reprint" },
  { id: "sv-base-etb", name: "Scarlet & Violet Base Elite Trainer Box", set: "Scarlet & Violet", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Scarlet Violet Elite Trainer Box"), ebayQuery: "Scarlet Violet Base Elite Trainer Box", hotness: "✅ Stable", notes: "Entry-level SV set" },
  { id: "paldean-etb", name: "Paldean Fates Elite Trainer Box", set: "Paldean Fates", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Paldean Fates Elite Trainer Box"), ebayQuery: "Paldean Fates Elite Trainer Box", hotness: "🔥 Hot", notes: "Shiny cards — high demand" },
];

type TypeFilter = "All" | "ETB" | "Booster Box" | "Booster Bundle" | "Premium Collection";
const FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "All", label: "All" },
  { key: "ETB", label: "ETB" },
  { key: "Booster Box", label: "Booster Box" },
  { key: "Booster Bundle", label: "Booster Bundle" },
  { key: "Premium Collection", label: "Premium" },
];

const typeColors: Record<ProductType, string> = {
  "ETB": "bg-purple-950/60 border-purple-700/40 text-purple-400",
  "Booster Box": "bg-blue-950/60 border-blue-700/40 text-blue-400",
  "Booster Bundle": "bg-green-950/60 border-green-700/40 text-green-400",
  "Premium Collection": "bg-yellow-950/60 border-yellow-700/40 text-yellow-400",
  "Booster Pack": "bg-gray-800 border-gray-700 text-gray-400",
};

const hotnessColors: Record<Hotness, string> = {
  "🔥 Hot": "bg-orange-950/60 border-orange-700/40 text-orange-400",
  "📈 Rising": "bg-green-950/60 border-green-700/40 text-green-400",
  "✅ Stable": "bg-gray-800 border-gray-700 text-gray-400",
  "❄️ Cooling": "bg-blue-950/60 border-blue-700/40 text-blue-400",
};

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function ebayUrl(query: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${query} sealed`)}&LH_Sold=1&LH_Complete=1`;
}

type Verdict = { label: string; cls: string; Icon: typeof CheckCircle2 };
function verdictFor(roi: number): Verdict {
  if (roi > 30) return { label: "Flip It", cls: "bg-green-950/80 border-green-700/50 text-green-400", Icon: CheckCircle2 };
  if (roi >= 10) return { label: "Watch", cls: "bg-yellow-950/80 border-yellow-700/50 text-yellow-400", Icon: AlertTriangle };
  return { label: "Pass", cls: "bg-red-950/80 border-red-700/50 text-red-400", Icon: XCircle };
}

export default function Packs() {
  const [filter, setFilter] = useState<TypeFilter>("All");
  const [prices, setPrices] = useState<Record<string, string>>({});

  // Market prices persist per product in localStorage (pack-price-{id})
  useEffect(() => {
    const loaded: Record<string, string> = {};
    for (const p of PRODUCTS) {
      const stored = localStorage.getItem(`pack-price-${p.id}`);
      if (stored) loaded[p.id] = stored;
    }
    setPrices(loaded);
  }, []);

  function updatePrice(id: string, value: string) {
    setPrices(prev => ({ ...prev, [id]: value }));
    if (value.trim()) localStorage.setItem(`pack-price-${id}`, value);
    else localStorage.removeItem(`pack-price-${id}`);
  }

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
          const market = parseFloat(raw);
          const hasPrice = !isNaN(market) && market > 0;
          const gross = hasPrice ? market - product.msrp : 0;
          const net = hasPrice ? market * (1 - FEE_RATE) - SEALED_SHIPPING - product.msrp : 0;
          const roi = hasPrice ? (net / product.msrp) * 100 : 0;
          const verdict = hasPrice ? verdictFor(roi) : null;

          return (
            <div key={product.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-5 flex flex-col transition-all">
              {/* Name + badges */}
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="font-semibold text-white text-sm leading-tight">{product.name}</div>
                <span className={`flex-shrink-0 border text-[11px] font-medium px-2 py-0.5 rounded-full ${hotnessColors[product.hotness]}`}>
                  {product.hotness}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="bg-gray-800 border border-gray-700 text-gray-400 text-[11px] font-medium px-2 py-0.5 rounded-full">
                  {product.set}
                </span>
                <span className={`border text-[11px] font-medium px-2 py-0.5 rounded-full ${typeColors[product.type]}`}>
                  {product.type}
                </span>
              </div>
              <p className="text-gray-500 text-xs mb-4">{product.notes}</p>

              {/* MSRP + market price input */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                  <div className="text-gray-500 text-[11px] mb-0.5">MSRP</div>
                  <div className="text-white text-base font-bold tabular">${fmt(product.msrp)} <span className="text-gray-600 text-[11px] font-normal">retail</span></div>
                </div>
                <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5">
                  <div className="text-gray-500 text-[11px] mb-0.5">Current Market Price</div>
                  <div className="relative">
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={raw}
                      onChange={e => updatePrice(product.id, e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent border-0 border-b border-gray-700 focus:border-yellow-400/60 pl-4 py-0.5 text-base font-bold text-white tabular placeholder-gray-700 focus:outline-none"
                    />
                  </div>
                </div>
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
                    <span className="text-gray-500">ROI <span className="tabular font-medium text-white ml-1">{roi >= 0 ? "+" : ""}{roi.toFixed(1)}%</span></span>
                    {verdict && (
                      <span className={`flex items-center gap-1 border text-[11px] font-bold px-2.5 py-1 rounded-full ${verdict.cls}`}>
                        <verdict.Icon size={11} /> {verdict.label}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 text-xs italic mb-4">
                  Enter the price you see on eBay (sold listings) to calculate your profit.
                </p>
              )}

              {/* Actions */}
              <div className="mt-auto grid grid-cols-2 gap-2">
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
          );
        })}
      </div>

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
