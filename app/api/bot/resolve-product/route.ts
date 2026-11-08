import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/bot/resolve-product
 *
 * Resolve any Target product from a pasted URL or raw TCIN into the info the
 * "Add to bot" flow needs: name, current price, image, availability. This is
 * what makes it possible to arm ANY Target product from the web UI in one
 * paste — no more SQL or zip edits to hunt something new.
 *
 * Resolution strategy (fast → robust):
 *   1. Target's RedSky product_summary API (clean JSON — but Akamai-walled
 *      from some cloud IPs, so it may 403; that's fine, we fall through)
 *   2. The product page itself (target.com/p/-/A-<TCIN> is server-rendered
 *      and fetchable from cloud IPs) — parse the embedded __NEXT_DATA__ blob
 *      for title / price / image / availability
 *   3. If both are blocked: return the TCIN unresolved and let the caller
 *      add it with a manually-typed name + cap (still fully functional).
 *
 * READ-ONLY: this route only reads publicly visible listing data, exactly
 * what a browser shows when you open the product page.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const REDSKY_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const REDSKY = "https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1";

function productUrl(tcin: string): string {
  return `https://www.target.com/p/-/A-${tcin}`;
}

/** Pull the TCIN out of a pasted target.com URL or a raw TCIN string. */
/** Target titles arrive with HTML entities (Pok&#233;mon) — decode them. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m: string, d: string) => String.fromCharCode(Number(d)))
    .replace(/"/g, '"')
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function extractTcin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // .../p/whatever-name/-/A-12345678 (digits after the final A-)
  const m = trimmed.match(/A-(\d{6,12})/);
  if (m) return m[1];
  // bare TCIN
  if (/^\d{6,12}$/.test(trimmed)) return trimmed;
  return null;
}

type Resolved = {
  tcin: string;
  name: string | null;
  price: number | null;
  imageUrl: string | null;
  availability: "in-stock" | "out-of-stock" | "preorder" | "unknown" | null;
  url: string;
  source: "redsky" | "product-page" | "unresolved" | "pokemoncenter" | "pokemoncenter-manual";
};

/** Strategy 1: RedSky product summary (the same API the DropBot monitor polls). */
async function viaRedsky(tcin: string): Promise<Resolved | null> {
  const params = new URLSearchParams({
    key: REDSKY_KEY,
    tcins: tcin,
    channel: "WEB",
    page: "/c/d4gjq",
    has_required_store_id: "false",
  });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${REDSKY}?${params.toString()}`, {
      headers: {
        "user-agent": UA,
        accept: "application/json",
        origin: "https://www.target.com",
        referer: "https://www.target.com/",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.data?.product_summaries?.[0];
    if (!p) return null;
    const shipStatus = String(p?.fulfillment?.shipping_options?.availability_status ?? "").toUpperCase();
    const availability: Resolved["availability"] =
      shipStatus === "IN_STOCK" ? "in-stock"
      : shipStatus === "PREORDER" ? "preorder"
      : shipStatus === "OUT_OF_STOCK" ? "out-of-stock"
      : "unknown";
    const priceStr = p?.price?.formatted_current_price?.price_string ?? null;
    return {
      tcin,
      name: p?.item?.product_description?.title ? decodeEntities(p.item.product_description.title) : null,
      price: priceStr ? Number(String(priceStr).replace(/[^0-9.]/g, "")) || null : null,
      imageUrl: p?.item?.enrichment?.images?.primary_image_url ?? null,
      availability,
      url: productUrl(tcin),
      source: "redsky",
    };
  } catch {
    return null;
  }
}

/** Strategy 2: the server-rendered PDP page + its __NEXT_DATA__ blob. */
async function viaProductPage(tcin: string): Promise<Resolved | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(productUrl(tcin), {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 2000) return null;
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const next = JSON.parse(m[1]);
    const found = findProductNode(next);
    if (!found) return null;
    const priceStr = found.price ?? null;
    // The page shell can't be trusted for availability (loading skeletons read
    // as "in stock"); only the Product API result carries a real badge.
    const availability: Resolved["availability"] = null;
    return {
      tcin,
      name: found.title ?? null,
      price: priceStr ? Number(String(priceStr).replace(/[^0-9.]/g, "")) || null : null,
      imageUrl: found.image ?? null,
      availability,
      url: productUrl(tcin),
      source: "product-page",
    };
  } catch {
    return null;
  }
}

/**
 * Find {title, price, image} for the TCIN anywhere in the __NEXT_DATA__ tree.
 * The PDP's product node lives at
 * ...data_source_modules.module_data.data.product.item.product_description
 * with the title inside it, and product images are scene7 URLs. Price is NOT
 * in the server HTML (it loads via Target's deferred-enrichment call), so it
 * may come back null — the UI then asks for a price cap by hand.
 */
function findProductNode(root: unknown): { title: string | null; price: string | null; image: string | null } | null {
  let title: string | null = null;
  let price: string | null = null;
  let image: string | null = null;
  const walk = (obj: unknown): void => {
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    // Title: product_description.title (the real PDP product node).
    if (!title && rec.product_description && typeof rec.product_description === "object") {
      const pd = rec.product_description as Record<string, unknown>;
      if (typeof pd.title === "string" && pd.title.length > 5) title = pd.title as string;
    }
    // Price: formatted price strings like "$59.99" if present anywhere.
    if (!price && typeof rec.price_string === "string" && /^\$\d/.test(rec.price_string as string)) {
      price = rec.price_string as string;
    }
    // Image: primary product image URL (scene7 on Target).
    if (!image && typeof rec.primary_image_url === "string") image = rec.primary_image_url as string;
    for (const k of Object.keys(rec)) walk(rec[k]);
  };
  walk(root);
  // scene7 images are the PDP's real product shots
  if (!image && title) {
    const m = JSON.stringify(root).match(/https:\/\/[^"]*scene7[^"]*/);
    if (m) image = m[0];
  }
  // TS can't track the assignment inside the walk closure — read through a cast.
  const t = title as string | null;
  if (t) title = decodeEntities(t);
  if (!title && !price && !image) return null;
  return { title, price, image };
}


/**
 * Pokémon Center: product pages embed a full product object (name, price,
 * availability, images) in __NEXT_DATA__. The site blocks datacenter IPs
 * (DataDome), so from Vercel this usually fails — the UI then offers the
 * manual add and the bot machine (home IP) enriches the row on its first
 * poll via the pc_monitor.
 */
function extractPcSku(input: string): string | null {
  const m = input.match(/pokemoncenter\.com\/product\/([\w-]+)/i);
  if (m) return m[1];
  // bare SKU pasted (e.g. 10-10242-101)
  if (/^\d{2}-\d{4,6}-\d{2,3}$/.test(input.trim())) return input.trim();
  return null;
}

async function viaPokemonCenter(sku: string): Promise<Resolved | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://www.pokemoncenter.com/product/${sku}`, {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    let prod: Record<string, unknown> | null = null;
    const walk = (obj: unknown): void => {
      if (prod || !obj || typeof obj !== "object") return;
      if ((obj as Record<string, unknown>).addToCartForm !== undefined) { prod = obj as Record<string, unknown>; return; }
      for (const k of Object.keys(obj as Record<string, unknown>)) walk((obj as Record<string, unknown>)[k]);
    };
    walk(data);
    // TS can't track the closure assignment — read through a cast.
    const node = prod as Record<string, unknown> | null;
    if (!node) return null;
    const price = (node.listPrice as { amount?: number } | undefined)?.amount ?? null;
    const avail = String(node.availability ?? "").toUpperCase();
    return {
      tcin: sku,
      name: typeof node.name === "string" ? node.name : null,
      price: typeof price === "number" ? price : null,
      imageUrl: ((node.images as Array<{ high?: string }> | undefined)?.[0]?.high) ?? null,
      availability: avail === "AVAILABLE" ? "in-stock" : avail === "OUT_OF_STOCK" ? "out-of-stock" : "unknown",
      url: `https://www.pokemoncenter.com/product/${sku}`,
      source: "pokemoncenter",
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { url?: unknown; tcin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const input = typeof body.url === "string" ? body.url
    : typeof body.tcin === "string" || typeof body.tcin === "number" ? String(body.tcin)
    : "";
  // Pokémon Center URLs/SKUs first — they never contain a Target TCIN.
  if (/pokemoncenter\.com/i.test(input)) {
    const sku = extractPcSku(input);
    if (!sku) {
      return NextResponse.json(
        { error: "Could not find a Pokémon Center product code — paste a pokemoncenter.com product link (it contains /product/10-12345-678)." },
        { status: 400 },
      );
    }
    const viaPc = await viaPokemonCenter(sku);
    if (viaPc && viaPc.name) return NextResponse.json({ ok: true, product: viaPc });
    // Datacenter IP blocked (expected from Vercel) — hand back the SKU so the
    // UI offers a manual add; the machine enriches the row on its first poll.
    return NextResponse.json({
      ok: true,
      product: {
        tcin: sku,
        name: null,
        price: null,
        imageUrl: null,
        availability: null,
        url: `https://www.pokemoncenter.com/product/${sku}`,
        source: "pokemoncenter-manual",
      } satisfies Resolved,
      note: "Pokémon Center blocks server lookups — type the name and price cap; the bot machine fills in the details on its next sync.",
    });
  }

  const tcin = extractTcin(input);
  if (!tcin) {
    return NextResponse.json(
      { error: "Could not find a Target item number — paste a target.com product link (it contains /A-12345678) or the TCIN itself." },
      { status: 400 },
    );
  }

  const viaApi = await viaRedsky(tcin);
  if (viaApi && viaApi.name) {
    // Redsky gives price + availability; the PDP __NEXT_DATA__ has the scene7
    // image Redsky sometimes omits — merge when the image is missing.
    if (!viaApi.imageUrl || !viaApi.price) {
      const viaPage = await viaProductPage(tcin);
      if (viaPage?.name) {
        return NextResponse.json({
          ok: true,
          product: {
            ...viaApi,
            imageUrl: viaApi.imageUrl ?? viaPage.imageUrl,
            price: viaApi.price ?? viaPage.price,
          },
        });
      }
    }
    return NextResponse.json({ ok: true, product: viaApi });
  }

  const viaPage = await viaProductPage(tcin);
  if (viaPage && viaPage.name) return NextResponse.json({ ok: true, product: viaPage });

  // Both resolution paths blocked — still return the TCIN so the UI can offer
  // a manual add (name typed by the user, cap set by hand).
  return NextResponse.json({
    ok: true,
    product: {
      tcin,
      name: null,
      price: null,
      imageUrl: null,
      availability: "unknown",
      url: productUrl(tcin),
      source: "unresolved",
    } satisfies Resolved,
    note: "Target blocked the lookup from the server — add it manually with a name and price cap.",
  });
}
