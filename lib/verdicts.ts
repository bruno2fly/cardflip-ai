/**
 * Decision engine — synthesizes REAL signals into a plain-English
 * BUY / WAIT / SELL / AVOID verdict via Perplexity's Sonar API.
 *
 * Gated entirely behind PERPLEXITY_API_KEY, same graceful-degradation
 * pattern as lib/stock.ts (Best Buy) and lib/discovery.ts (Brave): missing
 * key -> { configured: false }, every caller skips cleanly, nothing fakes
 * an answer. If the key IS set but the response doesn't cleanly parse into
 * verdict + confidence + reason, we return null rather than guess — no
 * verdict is stored/shown rather than storing a fabricated one.
 *
 * NEVER invent a signal that isn't actually present. Every field in
 * VerdictInputs is real, sourced data (or explicitly "unknown"); the prompt
 * says so directly so the model reasons from what's true, not what's assumed.
 */

export type Verdict = "BUY" | "WAIT" | "SELL" | "AVOID";
export type Confidence = "High" | "Medium" | "Low";

export type VerdictInputs = {
  productName: string;
  msrp: number | null;

  // TCGPlayer live market price (lib/sealedPricing.ts / lib/discovery.ts)
  marketPrice: number | null;
  marketPriceSource: "tcgapi" | "tcgplayer-est" | "discovery-verification" | null;

  // Real 14-day price momentum (lib/priceTrend.ts) from the price_history log —
  // null when fewer than 3 real data points exist (never a fabricated trend)
  priceTrendDirection: "RISING" | "FALLING" | "STABLE" | null;
  priceTrendPercent: number | null; // percent change over the window, e.g. +23

  // Real-time retailer stock (lib/stock.ts) — "unknown" is a real, honest state
  bestBuyStatus: "in-stock" | "out-of-stock" | "unknown";
  bestBuyPrice: number | null;
  targetStatus: "in-stock" | "out-of-stock" | "unknown";

  // Release/restock timing (lib/releases.ts) — null when not an upcoming/recent set
  daysUntilRelease: number | null;
  daysSinceRelease: number | null;
  announcedVia: string | null;

  // Why this product surfaced at all (lib/discovery.ts) — null for curated products
  discoverySource: string | null;
  discoverySignal: string | null;

  // Owned-inventory context — null unless this verdict is for a held lot
  ownedCostBasis: number | null;  // what Jason actually paid, per unit
  ownedQty: number | null;
};

export type VerdictResult = {
  verdict: Verdict;
  confidence: Confidence;
  reason: string; // 2-3 short bullet-style lines, newline-separated
};

const PPLX_API = "https://api.perplexity.ai/chat/completions";
const MODEL = "sonar";

const VALID_VERDICTS = new Set<Verdict>(["BUY", "WAIT", "SELL", "AVOID"]);
const VALID_CONFIDENCE = new Set<Confidence>(["High", "Medium", "Low"]);

function fmtSignal(v: number | null, unit = ""): string {
  return v == null ? "unknown" : `${unit}${v}`;
}

/** Build a compact, factual prompt — only real signals, explicit "unknown" where we have none. */
function buildPrompt(inputs: VerdictInputs): string {
  const lines: string[] = [
    `Product: ${inputs.productName}`,
    `MSRP: ${inputs.msrp != null ? `$${inputs.msrp}` : "unknown"}`,
    `Live TCGPlayer market price: ${fmtSignal(inputs.marketPrice, "$")}${inputs.marketPriceSource ? ` (source: ${inputs.marketPriceSource})` : ""}`,
    `Best Buy live stock: ${inputs.bestBuyStatus}${inputs.bestBuyPrice != null ? ` at verified price $${inputs.bestBuyPrice}` : ""}`,
    `Target live stock: ${inputs.targetStatus}`,
  ];
  if (inputs.priceTrendDirection != null) {
    const pct = inputs.priceTrendPercent;
    const pctStr = pct != null ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(0)}% over 14 days)` : "";
    lines.push(`Real 14-day price momentum: ${inputs.priceTrendDirection}${pctStr}.`);
  } else {
    lines.push(`Real 14-day price momentum: unknown (not enough price history yet).`);
  }
  if (inputs.daysUntilRelease != null) lines.push(`Releases in ${inputs.daysUntilRelease} days.`);
  if (inputs.daysSinceRelease != null) lines.push(`Released ${inputs.daysSinceRelease} days ago.`);
  if (inputs.announcedVia) lines.push(`Announced via: ${inputs.announcedVia}.`);
  if (inputs.discoverySource) {
    lines.push(`Surfaced by automated discovery: ${inputs.discoverySource}${inputs.discoverySignal ? ` (${inputs.discoverySignal})` : ""}.`);
  }
  if (inputs.ownedCostBasis != null) {
    lines.push(`Jason ALREADY OWNS ${inputs.ownedQty ?? 1} unit(s), bought at $${inputs.ownedCostBasis}/unit. This is a HOLD-OR-SELL decision, not a buy decision.`);
  }

  const decisionFraming = inputs.ownedCostBasis != null
    ? "Given ONLY the real data above (never assume anything not stated — if a field says 'unknown', treat it as genuinely unknown), should Jason SELL now or WAIT (hold) for a better price? Verdict must be SELL or WAIT."
    : "Given ONLY the real data above (never assume anything not stated — if a field says 'unknown', treat it as genuinely unknown), should Jason BUY, WAIT, or AVOID this product? Verdict must be BUY, WAIT, or AVOID.";

  return `You are a factual sealed Pokemon TCG flipping analyst. ${decisionFraming}

${lines.join("\n")}

Respond in EXACTLY this format, nothing else:
VERDICT: <BUY|WAIT|SELL|AVOID>
CONFIDENCE: <High|Medium|Low>
REASON:
- <driver 1, one short factual sentence>
- <driver 2, one short factual sentence>
- <driver 3, optional, one short factual sentence>`;
}

/** Strict parse — any deviation returns null so we never store/show a guess. */
export function parseVerdictResponse(text: string): VerdictResult | null {
  const verdictMatch = text.match(/VERDICT:\s*(BUY|WAIT|SELL|AVOID)/i);
  const confidenceMatch = text.match(/CONFIDENCE:\s*(High|Medium|Low)/i);
  const reasonMatch = text.match(/REASON:\s*([\s\S]+)/i);
  if (!verdictMatch || !confidenceMatch || !reasonMatch) return null;

  const verdict = verdictMatch[1].toUpperCase() as Verdict;
  const confidenceRaw = confidenceMatch[1];
  const confidence = (confidenceRaw[0].toUpperCase() + confidenceRaw.slice(1).toLowerCase()) as Confidence;
  if (!VALID_VERDICTS.has(verdict) || !VALID_CONFIDENCE.has(confidence)) return null;

  const bullets = reasonMatch[1]
    .split("\n")
    .map(l => l
      .replace(/^[-*•]\s*/, "")     // leading bullet marker
      .replace(/\[\d+\]/g, "")      // Sonar's inline citation markers, e.g. [1][2]
      .replace(/\*\*/g, "")         // markdown bold
      .replace(/\s+([.,;:])/g, "$1") // stray space left where a citation was removed
      .replace(/\s{2,}/g, " ")
      .trim())
    .filter(Boolean)
    .slice(0, 3);
  if (bullets.length === 0) return null;

  return { verdict, confidence, reason: bullets.map(b => `- ${b}`).join("\n") };
}

/** A source Sonar consulted during its live web search — kept for the audit trail. */
export type VerdictCitation = { url: string; title?: string };

/**
 * Domains that are actually about TCG pricing / retail stock / product info.
 * Sonar does its own live web search while writing the verdict, which often
 * surfaces generic junk (youtube, github, app-store links) that isn't
 * evidence of anything. We only keep sources from these.
 */
const CITATION_ALLOWLIST = new Set([
  "tcgplayer.com", "pricecharting.com", "ebay.com", "target.com", "bestbuy.com",
  "walmart.com", "pokemoncenter.com", "pokemon.com", "reddit.com",
  "pokeguardian.com", "pokebeach.com", "serebii.net",
  // additional obviously-relevant TCG price/marketplace sources
  "cardmarket.com", "tcgcollector.com", "pkmncards.com",
]);

/**
 * Strong pricing authorities: inherently product-price sources, so they don't
 * need to name-match the product to be relevant.
 */
const CITATION_STRONG_AUTHORITY = new Set(["tcgplayer.com", "pricecharting.com"]);

/** Generic product-type words that don't identify a SPECIFIC product. */
const NAME_STOPWORDS = new Set([
  "pokemon", "pokémon", "tcg", "trading", "card", "game", "scarlet", "violet",
  "elite", "trainer", "box", "booster", "bundle", "premium", "collection",
  "pack", "the", "and", "of", "sv", "set",
]);

/** Registrable domain of a URL (strip www / any subdomain). null if unparseable. */
function registrableDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : host;
  } catch { return null; }
}

/** Discriminating tokens from a product name (drops generic stopwords). */
function nameTokens(productName: string): string[] {
  return productName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/**
 * Pull sources from the raw API response and KEEP ONLY ones that are actually
 * relevant to this product's price/stock:
 *   1. hostname must be on the pricing/stock allowlist (drops youtube/github/etc.)
 *   2. AND either the title/URL contains a discriminating word from the product
 *      name, OR the source is a strong price authority (tcgplayer/pricecharting).
 *
 * Perplexity returns both `search_results` (title+url) and `citations` (bare
 * urls); we read both. If nothing survives the filter we return [] — showing
 * no sources is more honest than showing wrong ones. Never fabricates.
 */
export function extractCitations(raw: unknown, productName: string): VerdictCitation[] {
  const json = raw as {
    search_results?: { url?: unknown; title?: unknown }[] | null;
    citations?: unknown[] | null;
  };
  const tokens = nameTokens(productName);

  const relevant = (url: string, title?: string): boolean => {
    const domain = registrableDomain(url);
    if (!domain || !CITATION_ALLOWLIST.has(domain)) return false;
    if (CITATION_STRONG_AUTHORITY.has(domain)) return true;
    if (tokens.length === 0) return true; // no discriminating tokens to test → allow on-allowlist source
    const hay = `${title ?? ""} ${url}`.toLowerCase();
    return tokens.some(t => hay.includes(t));
  };

  const out: VerdictCitation[] = [];
  const seen = new Set<string>();

  for (const r of json?.search_results ?? []) {
    const url = typeof r?.url === "string" ? r.url : "";
    const title = typeof r?.title === "string" && r.title ? r.title : undefined;
    if (url.startsWith("http") && !seen.has(url) && relevant(url, title)) {
      seen.add(url);
      out.push({ url, ...(title ? { title } : {}) });
    }
  }
  for (const u of json?.citations ?? []) {
    if (typeof u === "string" && u.startsWith("http") && !seen.has(u) && relevant(u)) {
      seen.add(u);
      out.push({ url: u });
    }
  }
  return out.slice(0, 8);
}

export type VerdictCallResult =
  | { configured: false }
  | { configured: true; result: VerdictResult | null; citations: VerdictCitation[]; error?: string };

/**
 * Calls Perplexity Sonar with a compact factual prompt built from real
 * signals only. Returns configured:false when PERPLEXITY_API_KEY is
 * missing (feature is completely inert without it). Returns result:null
 * when the key IS set but the call fails or the response doesn't cleanly
 * parse — fail closed, never fabricate a verdict.
 */
export async function computeVerdict(inputs: VerdictInputs): Promise<VerdictCallResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { configured: false };

  try {
    const res = await fetch(PPLX_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: "You are a factual, concise analyst. Follow the requested output format exactly. Never invent data not given to you." },
          { role: "user", content: buildPrompt(inputs) },
        ],
      }),
    });
    if (!res.ok) {
      return { configured: true, result: null, citations: [], error: `Perplexity API responded ${res.status}` };
    }
    const json = await res.json();
    const citations = extractCitations(json, inputs.productName);
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return { configured: true, result: null, citations, error: "No content in Perplexity response" };
    }
    const parsed = parseVerdictResponse(text);
    if (!parsed) {
      return { configured: true, result: null, citations, error: "Response did not parse into verdict/confidence/reason" };
    }
    return { configured: true, result: parsed, citations };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { configured: true, result: null, citations: [], error: message };
  }
}
