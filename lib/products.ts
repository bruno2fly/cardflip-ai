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
  imageUrl: string;          // real box photo (TCGPlayer CDN) or set logo fallback
  tcgProductId?: number;     // pinned TCGPlayer id — fallback price source + images
  hotness: Hotness;
  notes: string;
};

/** Real sealed-product box photo from TCGPlayer's public image CDN. */
function tcgProductImg(productId: number) {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_400x400.jpg`;
}

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
  { id: "prismatic-etb", imageUrl: tcgProductImg(593355), tcgProductId: 593355, name: "Prismatic Evolutions Elite Trainer Box", set: "Prismatic Evolutions", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Elite Trainer Box"), ...retailLinks("Prismatic Evolutions Elite Trainer Box"), ebayQuery: "Prismatic Evolutions Elite Trainer Box", hotness: "🔥 Hot", notes: "Selling $150–200+ — most flipped ETB in 2024" },
  { id: "prismatic-bundle", imageUrl: tcgProductImg(600518), tcgProductId: 600518, name: "Prismatic Evolutions Booster Bundle", set: "Prismatic Evolutions", type: "Booster Bundle", msrp: 29.99, tcgplayerUrl: tcgUrl("Prismatic Evolutions Booster Bundle"), ...retailLinks("Prismatic Evolutions Booster Bundle"), ebayQuery: "Prismatic Evolutions Booster Bundle", hotness: "🔥 Hot", notes: "6 packs, flipping $70–90" },
  { id: "surging-etb", imageUrl: tcgProductImg(565630), tcgProductId: 565630, name: "Surging Sparks Elite Trainer Box", set: "Surging Sparks", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Surging Sparks Elite Trainer Box"), ...retailLinks("Surging Sparks Elite Trainer Box"), ebayQuery: "Surging Sparks Elite Trainer Box", hotness: "📈 Rising", notes: "Recently out of stock at retail" },
  { id: "surging-box", imageUrl: tcgProductImg(565606), tcgProductId: 565606, name: "Surging Sparks Booster Box", set: "Surging Sparks", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Surging Sparks Booster Box"), ...retailLinks("Surging Sparks Booster Box"), ebayQuery: "Surging Sparks Booster Box", hotness: "📈 Rising", notes: "Trending up as stock dries" },
  { id: "stellar-etb", imageUrl: tcgProductImg(557350), tcgProductId: 557350, name: "Stellar Crown Elite Trainer Box", set: "Stellar Crown", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Stellar Crown Elite Trainer Box"), ...retailLinks("Stellar Crown Elite Trainer Box"), ebayQuery: "Stellar Crown Elite Trainer Box", hotness: "✅ Stable", notes: "Steady $55–65 range" },
  { id: "twilight-etb", imageUrl: tcgProductImg(543845), tcgProductId: 543845, name: "Twilight Masquerade Elite Trainer Box", set: "Twilight Masquerade", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Twilight Masquerade Elite Trainer Box"), ...retailLinks("Twilight Masquerade Elite Trainer Box"), ebayQuery: "Twilight Masquerade Elite Trainer Box", hotness: "❄️ Cooling", notes: "Was hot, stabilizing $60–70" },
  { id: "paradox-box", imageUrl: tcgProductImg(512821), tcgProductId: 512821, name: "Paradox Rift Booster Box", set: "Paradox Rift", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Paradox Rift Booster Box"), ...retailLinks("Paradox Rift Booster Box"), ebayQuery: "Paradox Rift Booster Box", hotness: "📈 Rising", notes: "Singles still in demand" },
  { id: "obsidian-etb", imageUrl: tcgProductImg(501264), tcgProductId: 501264, name: "Obsidian Flames Elite Trainer Box", set: "Obsidian Flames", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Obsidian Flames Elite Trainer Box"), ...retailLinks("Obsidian Flames Elite Trainer Box"), ebayQuery: "Obsidian Flames Elite Trainer Box", hotness: "📈 Rising", notes: "Charizard set — collectors hold" },
  { id: "151-etb", imageUrl: tcgProductImg(503313), tcgProductId: 503313, name: "Pokemon 151 Elite Trainer Box", set: "Pokemon 151", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Pokemon 151 Elite Trainer Box"), ...retailLinks("Pokemon 151 Elite Trainer Box"), ebayQuery: "Pokemon 151 Elite Trainer Box", hotness: "🔥 Hot", notes: "One of best ETBs ever — premium price" },
  { id: "151-box", imageUrl: "https://images.pokemontcg.io/sv3pt5/logo.png", name: "Pokemon 151 Booster Box", set: "Pokemon 151", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Pokemon 151 Booster Box"), ...retailLinks("Pokemon 151 Booster Box"), ebayQuery: "Pokemon 151 Booster Box", hotness: "🔥 Hot", notes: "Sealed box fetches $250–400+" },
  { id: "evolving-box", imageUrl: tcgProductImg(242436), tcgProductId: 242436, name: "Evolving Skies Booster Box", set: "Evolving Skies", type: "Booster Box", msrp: 143.64, tcgplayerUrl: tcgUrl("Evolving Skies Booster Box"), ...retailLinks("Evolving Skies Booster Box"), ebayQuery: "Evolving Skies Booster Box", hotness: "🔥 Hot", notes: "Umbreon VMAX set — premium forever" },
  { id: "crown-etb", imageUrl: tcgProductImg(453470), tcgProductId: 453470, name: "Crown Zenith Elite Trainer Box", set: "Crown Zenith", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Crown Zenith Elite Trainer Box"), ...retailLinks("Crown Zenith Elite Trainer Box"), ebayQuery: "Crown Zenith Elite Trainer Box", hotness: "📈 Rising", notes: "Special set, limited reprint" },
  { id: "sv-base-etb", imageUrl: tcgProductImg(478336), tcgProductId: 478336, name: "Scarlet & Violet Base Elite Trainer Box", set: "Scarlet & Violet", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Scarlet Violet Elite Trainer Box"), ...retailLinks("Scarlet Violet Elite Trainer Box"), ebayQuery: "Scarlet Violet Base Elite Trainer Box", hotness: "✅ Stable", notes: "Entry-level SV set" },
  { id: "paldean-etb", imageUrl: tcgProductImg(528040), tcgProductId: 528040, name: "Paldean Fates Elite Trainer Box", set: "Paldean Fates", type: "ETB", msrp: 49.99, tcgplayerUrl: tcgUrl("Paldean Fates Elite Trainer Box"), ...retailLinks("Paldean Fates Elite Trainer Box"), ebayQuery: "Paldean Fates Elite Trainer Box", hotness: "🔥 Hot", notes: "Shiny cards — high demand" },

  // --- Booster boxes (IDs verified live: image 200 + pricepoints + name match) ---
  { id: "stellar-box", imageUrl: tcgProductImg(557354), tcgProductId: 557354, name: "Stellar Crown Booster Box", set: "Stellar Crown", type: "Booster Box", msrp: 161.64, tcgplayerUrl: tcgUrl("Stellar Crown Booster Box"), ...retailLinks("Stellar Crown Booster Box"), ebayQuery: "Stellar Crown Booster Box", hotness: "🔥 Hot", notes: "Trading ~$350 vs $162 retail — print run over" },
  { id: "twilight-box", imageUrl: tcgProductImg(543846), tcgProductId: 543846, name: "Twilight Masquerade Booster Box", set: "Twilight Masquerade", type: "Booster Box", msrp: 161.64, tcgplayerUrl: tcgUrl("Twilight Masquerade Booster Box"), ...retailLinks("Twilight Masquerade Booster Box"), ebayQuery: "Twilight Masquerade Booster Box", hotness: "🔥 Hot", notes: "~$360 market, 2.2× retail — OOP climber" },
  { id: "obsidian-box", imageUrl: tcgProductImg(501257), tcgProductId: 501257, name: "Obsidian Flames Booster Box", set: "Obsidian Flames", type: "Booster Box", msrp: 161.64, tcgplayerUrl: tcgUrl("Obsidian Flames Booster Box"), ...retailLinks("Obsidian Flames Booster Box"), ebayQuery: "Obsidian Flames Booster Box", hotness: "🔥 Hot", notes: "Charizard set — boxes near $400 and climbing" },
  { id: "sv-base-box", imageUrl: tcgProductImg(476452), tcgProductId: 476452, name: "Scarlet & Violet Booster Box", set: "Scarlet & Violet", type: "Booster Box", msrp: 161.64, tcgplayerUrl: tcgUrl("Scarlet Violet Booster Box"), ...retailLinks("Scarlet Violet Booster Box"), ebayQuery: "Scarlet Violet Base Booster Box", hotness: "📈 Rising", notes: "Base set at ~$315, ~2× retail — big print run, slow steady gains" },

  // --- Mega Evolution: Pitch Black (releases July 17, 2026 — presale window) ---
  { id: "pitchblack-box", imageUrl: tcgProductImg(692939), tcgProductId: 692939, name: "Pitch Black Booster Box", set: "Mega Evolution: Pitch Black", type: "Booster Box", msrp: 161.64, tcgplayerUrl: tcgUrl("Pitch Black Booster Box"), ...retailLinks("Pokemon Pitch Black Booster Box"), ebayQuery: "Pokemon Pitch Black Booster Box", hotness: "🔥 Hot", notes: "Presale ~$250, 1.5× retail BEFORE release — Mega Rayquaza hype" },
  { id: "pitchblack-bundle", imageUrl: tcgProductImg(692942), tcgProductId: 692942, name: "Pitch Black Booster Bundle", set: "Mega Evolution: Pitch Black", type: "Booster Bundle", msrp: 26.94, tcgplayerUrl: tcgUrl("Pitch Black Booster Bundle"), ...retailLinks("Pokemon Pitch Black Booster Bundle"), ebayQuery: "Pokemon Pitch Black Booster Bundle", hotness: "🔥 Hot", notes: "Presale ~$55, 2× MSRP before street date — grab at retail on drop day" },
  { id: "pitchblack-pc-etb", imageUrl: tcgProductImg(692949), tcgProductId: 692949, name: "Pitch Black Pokemon Center ETB (Exclusive)", set: "Mega Evolution: Pitch Black", type: "ETB", msrp: 59.99, tcgplayerUrl: tcgUrl("Pitch Black Pokemon Center Elite Trainer Box"), ...retailLinks("Pokemon Pitch Black Elite Trainer Box"), ebayQuery: "Pitch Black Pokemon Center Elite Trainer Box", hotness: "🔥 Hot", notes: "PC exclusive presale ~$475 (!) — only worth it at the $60 Pokemon Center drop" },

  // --- Booster bundles (special sets have no booster box — bundles ARE the play) ---
  { id: "stellar-bundle", imageUrl: tcgProductImg(557345), tcgProductId: 557345, name: "Stellar Crown Booster Bundle", set: "Stellar Crown", type: "Booster Bundle", msrp: 26.94, tcgplayerUrl: tcgUrl("Stellar Crown Booster Bundle"), ...retailLinks("Stellar Crown Booster Bundle"), ebayQuery: "Stellar Crown Booster Bundle", hotness: "📈 Rising", notes: "~$71 vs $27 retail — 2.6× and OOP" },
  { id: "surging-bundle", imageUrl: tcgProductImg(679564), tcgProductId: 679564, name: "Surging Sparks Booster Bundle", set: "Surging Sparks", type: "Booster Bundle", msrp: 26.94, tcgplayerUrl: tcgUrl("Surging Sparks Booster Bundle"), ...retailLinks("Surging Sparks Booster Bundle"), ebayQuery: "Surging Sparks Booster Bundle", hotness: "📈 Rising", notes: "~$63 retail SKU — Pikachu ex chase keeps demand up" },
  { id: "crown-bundle", imageUrl: tcgProductImg(527562), tcgProductId: 527562, name: "Crown Zenith Booster Bundle", set: "Crown Zenith", type: "Booster Bundle", msrp: 26.94, tcgplayerUrl: tcgUrl("Crown Zenith Booster Bundle"), ...retailLinks("Crown Zenith Booster Bundle"), ebayQuery: "Crown Zenith Booster Bundle", hotness: "🔥 Hot", notes: "~$213, 8× retail — special set with no booster box, bundles are the box" },
  { id: "paldean-bundle", imageUrl: tcgProductImg(528771), tcgProductId: 528771, name: "Paldean Fates Booster Bundle", set: "Paldean Fates", type: "Booster Bundle", msrp: 26.94, tcgplayerUrl: tcgUrl("Paldean Fates Booster Bundle"), ...retailLinks("Paldean Fates Booster Bundle"), ebayQuery: "Paldean Fates Booster Bundle", hotness: "🔥 Hot", notes: "~$163, 6× retail — shiny-set bundles never cooled" },
];
