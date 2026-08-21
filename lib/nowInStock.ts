const NOW_IN_STOCK_URL = "https://www.nowinstock.net/collectibles/tradingcards/pokemoncards/";
const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export type NowInStockListing = {
  rawName: string;
  retailer: string;
  status: "in-stock" | "out-of-stock" | "preorder" | "unknown";
  price: number | null;
  buyUrl: string;
  lastSeenInStock: string | null;
};

let cache: { fetchedAt: number; listings: NowInStockListing[]; bytes: number } | null = null;

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
      }
      return named[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
}

export function parseNowInStockHtml(html: string): NowInStockListing[] {
  const listings: NowInStockListing[] = [];
  const rows = html.match(/<tr\b[^>]*\bclass=["'][^"']*(?:onRow|offRow)[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi));
    if (cells.length < 2) continue;
    const firstLink = cells[0][2].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!firstLink) continue;

    const label = decodeHtml(firstLink[2]);
    const separator = label.lastIndexOf(" : ");
    if (separator < 1) continue;
    const rawName = label.slice(0, separator).trim();
    const retailer = label.slice(separator + 3).trim();
    const buyUrl = decodeHtml(attribute(firstLink[1], "href") ?? "");
    if (!rawName || !retailer || !buyUrl) continue;

    const statusClass = attribute(`<td${cells[1][1]}>`, "class") ?? "";
    let status: NowInStockListing["status"] = "unknown";
    if (/stockStatus(?:In|Available)\b/i.test(statusClass)) status = "in-stock";
    else if (/stockStatusOut\b/i.test(statusClass)) status = "out-of-stock";
    else if (/stockStatusPre\b/i.test(statusClass)) status = "preorder";

    const priceText = cells[2] ? decodeHtml(cells[2][2]) : "";
    const priceMatch = priceText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;

    const title = cells[3] ? attribute(`<td${cells[3][1]}>`, "title") : null;
    let lastSeenInStock: string | null = null;
    if (title && /^In Stock:\s*/i.test(title)) {
      const value = decodeHtml(title.replace(/^In Stock:\s*/i, ""));
      const timestamp = Date.parse(value.replace(/\s+-\s+/, " "));
      lastSeenInStock = Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
    }

    listings.push({ rawName, retailer, status, price, buyUrl, lastSeenInStock });
  }
  return listings;
}

export async function fetchNowInStockListings(force = false): Promise<NowInStockListing[]> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.listings;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(NOW_IN_STOCK_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const listings = parseNowInStockHtml(html);
    if (listings.length === 0) return [];
    cache = { fetchedAt: Date.now(), listings, bytes: html.length };
    return listings;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const STOP_WORDS = new Set(["pokemon", "the", "and", "with", "for", "tcg", "trading", "card", "game", "scarlet", "violet"]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function matchToProduct(rawName: string, catalog: { id: string; name: string }[]): string | null {
  const raw = normalize(rawName);
  let best: { id: string; score: number } | null = null;

  for (const product of catalog) {
    const normalizedName = normalize(product.name);
    const words = normalizedName.split(" ").filter(word => word.length > 2 && !STOP_WORDS.has(word));
    if (words.length === 0) continue;
    const present = words.filter(word => raw.includes(word)).length;
    const score = present / words.length;
    const type = ["elite trainer box", "booster bundle", "booster box", "premium collection", "booster pack"]
      .find(phrase => normalizedName.includes(phrase));
    const typeMatches = !type || raw.includes(type);
    if (typeMatches && score >= 0.7 && present >= 2 && (!best || score > best.score)) best = { id: product.id, score };
  }

  if (!best) console.warn(`[nowInStock] No catalog match above threshold for: ${rawName}`);
  return best?.id ?? null;
}

export function getNowInStockCacheInfo(): { bytes: number; listings: number } | null {
  return cache ? { bytes: cache.bytes, listings: cache.listings.length } : null;
}
