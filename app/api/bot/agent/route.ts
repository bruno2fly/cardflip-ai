import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Buy Bot agent endpoint — the ONLY route the Mac mini (DropBot) talks to.
 *
 * Auth: every request must carry header `x-bot-key: $BOT_AGENT_KEY` (set in
 * Vercel env). The key is a shared secret between this deployment and the
 * bot's config.json, not a user session — the mini has no browser login.
 * If BOT_AGENT_KEY is not configured the route 503s with a clear message
 * instead of silently allowing unauthenticated queue control.
 *
 * Protocol (POST JSON, one `action` per call):
 *   heartbeat → {version?, machine?}    stamp bot_config; echoes `armed` back
 *   config    →                          {armed, targets[]} for the mini's watchlist
 *   claim     →                          oldest queued order → running, returned to the agent
 *   update    → {orderId, status, error?, price?}   finish a claimed order
 *   report    → {tcin, productName, status, price?, error?}
 *              the bot bought (or failed) on its own detection — insert a
 *              completed order row so the platform shows the full history
 */

const ORDER_COLUMNS =
  "id, tcin, product_name, retailer, status, source, price, error, created_at, claimed_at, finished_at";

function unauthorized() {
  return NextResponse.json({ error: "bad or missing x-bot-key" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const expected = process.env.BOT_AGENT_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "BOT_AGENT_KEY env var is not set — set it in Vercel and put the same value in DropBot's config.json (bot_key)" },
      { status: 503 }
    );
  }
  if (req.headers.get("x-bot-key") !== expected) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const action = typeof body.action === "string" ? body.action : "";

  // -- heartbeat ------------------------------------------------------------
  if (action === "heartbeat") {
    const patch: Record<string, unknown> = { agent_heartbeat: new Date().toISOString() };
    if (typeof body.version === "string") patch.agent_version = body.version;
    if (typeof body.machine === "string") patch.agent_machine = body.machine;
    if (typeof body.profileReady === "boolean") patch.agent_profile_ready = body.profileReady;
    const { error } = await supabase.from("bot_config").update(patch).eq("id", 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: cfg } = await supabase
      .from("bot_config")
      .select("armed")
      .eq("id", 1)
      .single();
    return NextResponse.json({ ok: true, armed: cfg?.armed ?? false });
  }

  // -- config (arm state + auto-buy targets) ---------------------------------
  if (action === "config") {
    const { data: cfg } = await supabase
      .from("bot_config")
      .select("armed")
      .eq("id", 1)
      .single();
    // auto_buy column comes from supabase/watchlist_add_auto_buy.sql; if that
    // migration has not been run yet, degrade to an empty target list rather
    // than erroring the agent.
    const { data: rows, error } = await supabase
      .from("watchlist")
      .select("product_name, target_tcin, target_url, msrp, auto_buy")
      .not("target_tcin", "is", null);
    if (error) {
      const { data: fallback } = await supabase
        .from("watchlist")
        .select("product_name, target_tcin, target_url, msrp")
        .not("target_tcin", "is", null);
      return NextResponse.json({
        ok: true,
        armed: cfg?.armed ?? false,
        targets: [],
        warning: "auto_buy column missing — run supabase/watchlist_add_auto_buy.sql",
        catalogSize: fallback?.length ?? 0,
      });
    }
    const targets = (rows ?? [])
      .filter((r) => (r as { auto_buy?: boolean }).auto_buy)
      .map((r) => {
        const row = r as {
          product_name: string;
          target_tcin: number;
          target_url: string | null;
          msrp: number | null;
        };
        return {
          tcin: String(row.target_tcin),
          name: row.product_name,
          targetUrl: row.target_url ?? `https://www.target.com/p/-/A-${row.target_tcin}`,
          msrp: row.msrp,
        };
      });
    return NextResponse.json({ ok: true, armed: cfg?.armed ?? false, targets });
  }

  // -- claim (oldest queued → running) ---------------------------------------
  if (action === "claim") {
    const { data: queued, error } = await supabase
      .from("bot_orders")
      .select(ORDER_COLUMNS)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const first = (queued ?? [])[0] as
      | { id: string; status: string; tcin: string; product_name: string; price: number | null }
      | undefined;
    if (!first) return NextResponse.json({ ok: true, order: null });
    const { error: updErr } = await supabase
      .from("bot_orders")
      .update({ status: "running", claimed_at: new Date().toISOString() })
      .eq("id", first.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      order: {
        id: first.id,
        tcin: first.tcin,
        productName: first.product_name,
        price: first.price,
      },
    });
  }

  // -- update (finish a claimed order) ----------------------------------------
  if (action === "update") {
    const orderId = typeof body.orderId === "string" ? body.orderId : null;
    const status = typeof body.status === "string" ? body.status : null;
    if (!orderId || !status || !["ordered", "failed", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "orderId + status(ordered|failed|cancelled) required" }, { status: 400 });
    }
    const patch: Record<string, unknown> = {
      status,
      finished_at: new Date().toISOString(),
    };
    if (typeof body.error === "string") patch.error = body.error;
    if (typeof body.price === "number") patch.price = body.price;
    const { error } = await supabase.from("bot_orders").update(patch).eq("id", orderId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // -- report (bot executed on its own detection) ------------------------------
  if (action === "report") {
    const tcin = typeof body.tcin === "string" || typeof body.tcin === "number" ? String(body.tcin) : null;
    const status = typeof body.status === "string" ? body.status : null;
    if (!tcin || !status || !["ordered", "failed"].includes(status)) {
      return NextResponse.json({ error: "tcin + status(ordered|failed) required" }, { status: 400 });
    }
    const insert: Record<string, unknown> = {
      tcin,
      product_name: typeof body.productName === "string" ? body.productName : "",
      status,
      source: "auto",
      finished_at: new Date().toISOString(),
    };
    if (typeof body.price === "number") insert.price = body.price;
    if (typeof body.error === "string") insert.error = body.error;
    const { error } = await supabase.from("bot_orders").insert(insert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
}
