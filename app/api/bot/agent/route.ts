import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Buy Bot agent endpoint — the ONLY route the machines (DropBot) talk to.
 *
 * Auth: every request must carry header `x-bot-key`. The key resolves to ONE
 * row in bot_config (multi-bot: each machine has its own key + row, so two
 * machines can run two Target accounts side by side). The env-var
 * BOT_AGENT_KEY is the legacy/fallback key bound to row 1 for backward
 * compatibility. If nothing matches, 401.
 *
 * Protocol (POST JSON, one `action` per call):
 *   heartbeat → {version?, machine?}    stamp this bot's row; echoes `armed` back
 *   config    →                          {armed, targets[], dropWindows} (watchlist + windows are global)
 *   claim     →                          oldest queued order → running (atomic, first-wins across bots)
 *   update    → {orderId, status, error?, price?}   finish a claimed order
 *   report    → {tcin, productName, status, price?, error?}
 *              the bot bought (or failed) on its own detection — insert a
 *              completed order row stamped with this bot's id
 */

const ORDER_COLUMNS =
  "id, tcin, product_name, retailer, status, source, price, error, created_at, claimed_at, finished_at";

function unauthorized() {
  return NextResponse.json({ error: "bad or missing x-bot-key" }, { status: 401 });
}

/** Resolve the x-bot-key header to a bot_config row id (or null). */
async function resolveBotId(key: string | null): Promise<number | null> {
  if (!key || !supabase) return null;
  // exact match against per-bot keys
  const { data: byKey } = await supabase
    .from("bot_config")
    .select("id")
    .eq("bot_key", key)
    .maybeSingle();
  if (byKey) return (byKey as { id: number }).id;
  // legacy fallback: the env key belongs to row 1
  if (process.env.BOT_AGENT_KEY && key === process.env.BOT_AGENT_KEY) return 1;
  return null;
}

export async function POST(req: NextRequest) {
  const botId = await resolveBotId(req.headers.get("x-bot-key"));
  if (botId == null) {
    if (!process.env.BOT_AGENT_KEY) {
      return NextResponse.json(
        { error: "no bot keys configured — set BOT_AGENT_KEY in Vercel or add bot_key rows in bot_config" },
        { status: 503 }
      );
    }
    return unauthorized();
  }

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
    const { error } = await supabase.from("bot_config").update(patch).eq("id", botId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // armed is the GLOBAL kill switch (row 1) — every bot obeys the same switch
    const { data: cfg } = await supabase
      .from("bot_config")
      .select("armed")
      .eq("id", 1)
      .single();
    return NextResponse.json({ ok: true, armed: cfg?.armed ?? false });
  }

  // -- config (arm state + auto-buy targets) ---------------------------------
  if (action === "config") {
    // armed is the GLOBAL kill switch (row 1) — every bot obeys the same switch
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
    // Drop windows + armed are GLOBAL (row 1): all bots hunt the same
    // items on the same schedule; only identity/profiles are per-bot.
    const { data: cfgRow } = await supabase
      .from("bot_config")
      .select("drop_windows")
      .eq("id", 1)
      .single();
    const dropWindows = (cfgRow as { drop_windows?: unknown } | null)?.drop_windows ?? [];
    return NextResponse.json({ ok: true, armed: cfg?.armed ?? false, targets, dropWindows });
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
    // atomic first-wins: only transition if STILL queued (two bots can race
    // here - the loser gets no row back and simply polls again next cycle)
    const { data: won, error: updErr } = await supabase
      .from("bot_orders")
      .update({ status: "running", claimed_at: new Date().toISOString(), bot_id: botId })
      .eq("id", first.id)
      .eq("status", "queued")
      .select("id, tcin, product_name, price")
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    if (!won) return NextResponse.json({ ok: true, order: null, raced: true });
    const claimed = won as { id: string; tcin: string; product_name: string; price: number | null };
    return NextResponse.json({
      ok: true,
      order: {
        id: claimed.id,
        tcin: claimed.tcin,
        productName: claimed.product_name,
        price: claimed.price,
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
      bot_id: botId,
    };
    if (typeof body.price === "number") insert.price = body.price;
    if (typeof body.error === "string") insert.error = body.error;
    const { error } = await supabase.from("bot_orders").insert(insert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // -- pubkey (the mini publishes its RSA public key once) ----------------------
  if (action === "pubkey") {
    const pem = typeof body.pem === "string" && body.pem.includes("BEGIN") ? body.pem.trim() : null;
    if (!pem) return NextResponse.json({ error: "pem (public key) required" }, { status: 400 });
    const { data: cur } = await supabase
      .from("bot_config")
      .select("profile_pubkey")
      .eq("id", botId)
      .single();
    const changed = (cur as { profile_pubkey?: string | null } | null)?.profile_pubkey !== pem;
    const patch: Record<string, unknown> = { profile_pubkey: pem };
    if (changed) {
      // new key = any pending ciphertext is undecryptable; drop it
      patch.profile_ciphertext = null;
    }
    const { error } = await supabase.from("bot_config").update(patch).eq("id", botId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // -- profile (the mini fetches pending encrypted profile) --------------------
  if (action === "profile") {
    const { data } = await supabase
      .from("bot_config")
      .select("profile_ciphertext")
      .eq("id", botId)
      .single();
    const ct = (data as { profile_ciphertext?: string | null } | null)?.profile_ciphertext ?? null;
    return NextResponse.json({ ok: true, ciphertext: ct });
  }

  // -- profile-consumed (the mini decrypted + stored locally; report masked) ----
  if (action === "profile-consumed") {
    const masked = typeof body.masked === "string" ? body.masked.slice(0, 120) : null;
    if (!masked) return NextResponse.json({ error: "masked required" }, { status: 400 });
    const { error } = await supabase
      .from("bot_config")
      .update({ profile_ciphertext: null, profile_masked: masked, profile_updated_at: new Date().toISOString() })
      .eq("id", botId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action "${action}"` }, { status: 400 });
}
