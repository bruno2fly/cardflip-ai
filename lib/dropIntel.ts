const TYPA_URL = "https://www.typa.app/brands/pokemon";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const FORWARD_LOOKING = /\b(tonight|drop|loaded|backend|upcoming|expected|restocking)\b/i;

export type TypaCommunityUpdate = {
  headline: string;
  ageText: string;
  body: string;
};

let cache: { fetchedAt: number; updates: TypaCommunityUpdate[]; bytes: number } | null = null;

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

export function parseTypaCommunityHtml(html: string): TypaCommunityUpdate[] {
  const articles = html.match(/<article\b(?=[^>]*\brole=["']button["'])(?=[^>]*\baria-label=["']Open Pokemon Alert update:)[^>]*>[\s\S]*?<\/article>/gi) ?? [];
  if (articles.length === 0) {
    console.warn("[dropIntel] TYPA page contained no matching community update articles; markup may have changed");
    return [];
  }

  const updates: TypaCommunityUpdate[] = [];
  for (const article of articles) {
    const openTag = article.match(/^<article\b[^>]*>/i)?.[0] ?? "";
    const headline = decodeHtml(openTag.match(/\baria-label=["']Open Pokemon Alert update:\s*([\s\S]*?)["']/i)?.[1] ?? "");
    const ageText = decodeHtml(article.match(/<span\b[^>]*class=["'][^"']*text-xs[^"']*text-\[#6E6E6E\][^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const bodyContainer = article.match(/<div\b[^>]*class=["'][^"']*mt-1[^"']*text-sm[^"']*leading-\[1\.5\][^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const body = decodeHtml(bodyContainer.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    if (!headline || !ageText) continue;
    if (FORWARD_LOOKING.test(`${headline} ${body}`)) updates.push({ headline, ageText, body });
  }

  if (updates.length === 0) console.warn("[dropIntel] TYPA community articles parsed, but none matched the forward-looking filter");
  return updates;
}

/** Cached, failure-safe scrape of TYPA's public community feed. */
export async function fetchTypaCommunityUpdates(force = false): Promise<TypaCommunityUpdate[]> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.updates;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(TYPA_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!response.ok) {
      console.warn(`[dropIntel] TYPA fetch returned HTTP ${response.status}`);
      return [];
    }
    const html = await response.text();
    const updates = parseTypaCommunityHtml(html);
    cache = { fetchedAt: Date.now(), updates, bytes: html.length };
    return updates;
  } catch (error) {
    console.warn(`[dropIntel] TYPA fetch failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function getTypaCacheInfo(): { bytes: number; posts: number } | null {
  return cache ? { bytes: cache.bytes, posts: cache.updates.length } : null;
}
