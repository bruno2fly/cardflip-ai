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

export type VerdictCallResult =
  | { configured: false }
  | { configured: true; result: VerdictResult | null; error?: string };

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
      return { configured: true, result: null, error: `Perplexity API responded ${res.status}` };
    }
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return { configured: true, result: null, error: "No content in Perplexity response" };
    }
    const parsed = parseVerdictResponse(text);
    if (!parsed) {
      return { configured: true, result: null, error: "Response did not parse into verdict/confidence/reason" };
    }
    return { configured: true, result: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { configured: true, result: null, error: message };
  }
}
