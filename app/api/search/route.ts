import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TCG_API = "https://api.pokemontcg.io/v2/cards";

/**
 * GET /api/search?q=name:*QUERY*&pageSize=12
 *
 * Server-side proxy for Pokemon TCG API card search. The browser must not
 * call the API directly: without the POKEMONTCG_API_KEY (server-only env
 * var) requests get rate-limited and silently fail in production.
 * Returns { data: Card[] } — same shape the client already expects.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing required query param: q" }, { status: 400 });
  }
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") ?? "12", 10) || 12));

  const params = new URLSearchParams({
    q,
    pageSize: String(pageSize),
    orderBy: "-set.releaseDate",
    select: "id,name,set,number,rarity,images",
  });
  const headers: Record<string, string> = {};
  if (process.env.POKEMONTCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;

  try {
    const res = await fetch(`${TCG_API}?${params}`, {
      headers,
      // cache identical searches for 5 minutes to stay under rate limits
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Pokemon TCG API responded ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    return NextResponse.json({ data: json.data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Search failed: ${message}` }, { status: 502 });
  }
}
