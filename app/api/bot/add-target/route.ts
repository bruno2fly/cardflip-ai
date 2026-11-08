import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/bot/add-target
 *
 * Add (or update) a watchlist row for a Target TCIN with an auto-buy flag and
 * a price cap. This is the write side of the "paste any Target URL" flow:
 * /api/bot/resolve-product looks the product up, this route arms it.
 *
 * - New TCIN  → inserts a watchlist row with auto_buy + msrp cap
 * - Known TCIN → updates name / msrp / auto_buy (so re-adding fixes a price
 *   cap or re-arms an item without a duplicate row)
 *
 * Retail-price safety: the buyer's price guard rejects any live price above
 * the msrp cap stored here — the web UI should send the retailer's own listed
 * price (never a marketplace/scalper listing price).
 */

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  let body: {
    tcin?: unknown;
    name?: unknown;
    msrp?: unknown;
    autoBuy?: unknown;
    imageUrl?: unknown;
    url?: unknown;
    retailer?: unknown;
    sku?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const retailer = body.retailer === "pokemoncenter" ? "pokemoncenter" : "target";

  // Pokémon Center items: keyed by retailer_sku (e.g. 10-10242-101), no TCIN.
  // The name can be empty — the machine's pc_monitor enriches the row (name,
  // image, live price) on its first poll from a home IP.
  if (retailer === "pokemoncenter") {
    const sku = typeof body.sku === "string" ? body.sku.trim() : typeof body.tcin === "string" ? body.tcin.trim() : "";
    if (!/^\d{2}-\d{4,6}-\d{2,3}$/.test(sku)) {
      return NextResponse.json({ error: "Pokémon Center product code required (e.g. 10-10242-101, from the product link)" }, { status: 400 });
    }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 300) : `Pokémon Center ${sku}`;
    const msrpNum = Number(body.msrp);
    const msrp = Number.isFinite(msrpNum) && msrpNum > 0 ? msrpNum : null;
    if (msrp === null) {
      return NextResponse.json({ error: "msrp (price cap) required — the bot refuses to buy above it" }, { status: 400 });
    }
    const autoBuy = body.autoBuy === undefined ? true : Boolean(body.autoBuy);
    const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.startsWith("http") ? body.imageUrl : null;
    const url = typeof body.url === "string" && body.url.startsWith("http") ? body.url : `https://www.pokemoncenter.com/product/${sku}`;
    const now = new Date().toISOString();
    const row = {
      product_name: name,
      msrp,
      target_tcin: null,
      retailer,
      retailer_sku: sku,
      target_url: url,
      image_url: imageUrl,
      auto_buy: autoBuy,
      source: "web-add",
      updated_at: now,
    };
    const existing = await supabase
      .from("watchlist")
      .select("id")
      .eq("retailer", "pokemoncenter")
      .eq("retailer_sku", sku)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ error: `lookup failed: ${existing.error.message}` }, { status: 500 });
    }
    let saved;
    if (existing.data) {
      saved = await supabase.from("watchlist").update(row).eq("id", existing.data.id).select("id, product_name, msrp, auto_buy").single();
    } else {
      saved = await supabase.from("watchlist").insert({ ...row, id: crypto.randomUUID(), added_at: now }).select("id, product_name, msrp, auto_buy").single();
    }
    if (saved.error) {
      return NextResponse.json({ error: `save failed: ${saved.error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, updated: Boolean(existing.data), target: saved.data });
  }

  const tcinRaw = typeof body.tcin === "string" || typeof body.tcin === "number" ? String(body.tcin) : "";
  if (!/^\d{6,12}$/.test(tcinRaw)) {
    return NextResponse.json({ error: "tcin required" }, { status: 400 });
  }
  const tcin = Number(tcinRaw);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 300) : null;
  if (!name) {
    return NextResponse.json({ error: "name required — type one in if the lookup was blocked" }, { status: 400 });
  }
  const msrpNum = Number(body.msrp);
  const msrp = Number.isFinite(msrpNum) && msrpNum > 0 ? msrpNum : null;
  if (msrp === null) {
    return NextResponse.json({ error: "msrp (price cap) required — the bot refuses to buy above it" }, { status: 400 });
  }
  const autoBuy = body.autoBuy === undefined ? true : Boolean(body.autoBuy);
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.startsWith("http") ? body.imageUrl : null;
  const url = typeof body.url === "string" && body.url.startsWith("http") ? body.url : `https://www.target.com/p/-/A-${tcinRaw}`;

  const now = new Date().toISOString();
  const row = {
    product_name: name,
    msrp,
    target_tcin: tcin,
    target_url: url,
    image_url: imageUrl,
    auto_buy: autoBuy,
    source: "web-add",
    updated_at: now,
  };

  // Upsert on target_tcin: update if it's already on the watchlist, insert otherwise.
  const existing = await supabase
    .from("watchlist")
    .select("id")
    .eq("target_tcin", tcin)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ error: `lookup failed: ${existing.error.message}` }, { status: 500 });
  }

  let saved;
  if (existing.data) {
    saved = await supabase
      .from("watchlist")
      .update(row)
      .eq("id", existing.data.id)
      .select("id, product_name, msrp, auto_buy")
      .single();
  } else {
    saved = await supabase
      .from("watchlist")
      .insert({ ...row, id: crypto.randomUUID(), added_at: now })
      .select("id, product_name, msrp, auto_buy")
      .single();
  }

  if (saved.error) {
    return NextResponse.json({ error: `save failed: ${saved.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    updated: Boolean(existing.data),
    target: saved.data,
  });
}
