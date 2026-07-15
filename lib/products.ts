/**
 * Curated sealed-product list — shared by the home page (Sealed Product
 * Tracker), /api/stock, and the stock-alert cron.
 */

export type ProductType = "ETB" | "Booster Box" | "Booster Bundle" | "Premium Collection" | "Booster Pack";
export type Hotness = "🔥 Hot" | "📈 Rising" | "✅ Stable" | "❄️ Cooling";

export type SealedProduct = {
  id: string;
  name: string;
  set: string;
  type: ProductType;
  msrp: number;
  tcgplayerUrl: string;      // resell market
  ebayQuery: string;         // resell market (sold listings)
  walmartUrl: string;        // buy at retail
  targetUrl: string;         // buy at retail
  bestbuyUrl: string;        // buy at retail
  pokemonCenterUrl: string;  // buy at retail
  hotness: Hotness;
  notes: string;
};

function tcgUrl(name: string) {
  return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(name)}&view=grid`;
}

/** Public retailer search URLs — where Jason actually BUYS, at MSRP. */
function retailLinks(name: string): Pick<SealedProduct, "walmartUrl" | "targetUrl" | "bestbuyUrl" | "pokemonCenterUrl"> {
  const q = encodeURIComponent(name);
  return {
    walmartUrl: `https://www.walmart.com/search?q=${q}`,
    targetUrl: `https://www.target.com/s?searchTerm=${q}`,
    bestbuyUrl: `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`,
    pokemonCenterUrl: `https://www.pokemoncenter.com/search/${q}`,
  };
}

export const PRODUCTS: SealedProduct[] = [
  { id: "prismatic-etb", name: "Prismatic Evolutions Elite Trainer Box", set: "Prismatic Evolutions", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Elite Trainer Box"), ...retailLinks("Prismatic Evolutions Elite Trainer Box"), ebayQuery: "Prismatic Evolutions Elite Trainer Box", hotness: "🔥 Hot", notes: "Selling $150–200+ — most flipped ETB in 2024" },
  { id: "prismatic-bundle", name: "Prismatic Evolutions Booster Bundle", set: "Prismatic Evolutions", type: "Booster Bundle", msrp: 29.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Booster Bundle"), ...retailLinks("Prismatic Evolutions Booster Bundle"), ebayQuery: "Prismatic Evolutions Booster Bundle", hotness: "🔥 Hot", notes: "6 packs, flipping $70–90" },
  { id: "surging-etb", name: "Surging Sparks Elite Trainer Box", set: "Surging Sparks", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Surging Sparks Elite Trainer Box"), ...retailLinks("Surging Sparks Elite Trainer Box"), ebayQuery: "Surging Sparks Elite Trainer Box", hotness: "📈 Rising", notes: "Recently out of stock at retail" },
  { id: "surging-box", name: "Surging Sparks Booster Box", set: "Surging Sparks", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Surging Sparks Booster Box"), ...retailLinks("Surging Sparks Booster Box"), ebayQuery: "Surging Sparks Booster Box", hotness: "📈 Rising", notes: "Trending up as stock dries" },
  { id: "stellar-etb", name: "Stellar Crown Elite Trainer Box", set: "Stellar Crown", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Stellar Crown Elite Trainer Box"), ...retailLinks("Stellar Crown Elite Trainer Box"), ebayQuery: "Stellar Crown Elite Trainer Box", hotness: "✅ Stable", notes: "Steady $55–65 range" },
  { id: "twilight-etb", name: "Twilight Masquerade Elite Trainer Box", set: "Twilight Masquerade", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Twilight Masquerade Elite Trainer Box"), ...retailLinks("Twilight Masquerade Elite Trainer Box"), ebayQuery: "Twilight Masquerade Elite Trainer Box", hotness: "❄️ Cooling", notes: "Was hot, stabilizing $60–70" },
  { id: "paradox-box", name: "Paradox Rift Booster Box", set: "Paradox Rift", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Paradox Rift Booster Box"), ...retailLinks("Paradox Rift Booster Box"), ebayQuery: "Paradox Rift Booster Box", hotness: "📈 Rising", notes: "Singles still in demand" },
  { id: "obsidian-etb", name: "Obsidian Flames Elite Trainer Box", set: "Obsidian Flames", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Obsidian Flames Elite Trainer Box"), ...retailLinks("Obsidian Flames Elite Trainer Box"), ebayQuery: "Obsidian Flames Elite Trainer Box", hotness: "📈 Rising", notes: "Charizard set — collectors hold" },
  { id: "151-etb", name: "Pokemon 151 Elite Trainer Box", set: "Pokemon 151", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Pokemon 151 Elite Trainer Box"), ...retailLinks("Pokemon 151 Elite Trainer Box"), ebayQuery: "Pokemon 151 Elite Trainer Box", hotness: "🔥 Hot", notes: "One of best ETBs ever — premium price" },
  { id: "151-box", name: "Pokemon 151 Booster Box", set: "Pokemon 151", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Pokemon 151 Booster Box"), ...retailLinks("Pokemon 151 Booster Box"), ebayQuery: "Pokemon 151 Booster Box", hotness: "🔥 Hot", notes: "Sealed box fetches $250–400+" },
  { id: "evolving-box", name: "Evolving Skies Booster Box", set: "Evolving Skies", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Evolving Skies Booster Box"), ...retailLinks("Evolving Skies Booster Box"), ebayQuery: "Evolving Skies Booster Box", hotness: "🔥 Hot", notes: "Umbreon VMAX set — premium forever" },
  { id: "crown-etb", name: "Crown Zenith Elite Trainer Box", set: "Crown Zenith", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Crown Zenith Elite Trainer Box"), ...retailLinks("Crown Zenith Elite Trainer Box"), ebayQuery: "Crown Zenith Elite Trainer Box", hotness: "📈 Rising", notes: "Special set, limited reprint" },
  { id: "sv-base-etb", name: "Scarlet & Violet Base Elite Trainer Box", set: "Scarlet & Violet", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Scarlet Violet Elite Trainer Box"), ...retailLinks("Scarlet Violet Elite Trainer Box"), ebayQuery: "Scarlet Violet Base Elite Trainer Box", hotness: "✅ Stable", notes: "Entry-level SV set" },
  { id: "paldean-etb", name: "Paldean Fates Elite Trainer Box", set: "Paldean Fates", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Paldean Fates Elite Trainer Box"), ...retailLinks("Paldean Fates Elite Trainer Box"), ebayQuery: "Paldean Fates Elite Trainer Box", hotness: "🔥 Hot", notes: "Shiny cards — high demand" },
];
