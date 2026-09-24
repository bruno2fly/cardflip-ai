import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBotConfig, listBotOrders, agentIsOnline, activeDropWindow } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Buy Bot page snapshot — one GET the /bot page (and any future status
 * pill) can poll: config (arm + heartbeat), recent orders, and the
 * watchlist rows that have a Target TCIN so each can show/toggle auto-buy.
 */

export async function GET() {
  const [config, orders] = await Promise.all([getBotConfig(), listBotOrders(100)]);

  let targets: Array<{
    tcin: string;
    name: string;
    msrp: number | null;
    autoBuy: boolean;
  }> = [];
  let targetsWarning: string | null = null;

  if (supabase) {
    // Full column list first; if the auto_buy migration hasn't been run yet,
    // fall back to the base columns and warn instead of breaking the page.
    let rows: Record<string, unknown>[] | null = null;
    const q = await supabase
      .from("watchlist")
      .select("product_name, target_tcin, msrp, auto_buy")
      .not("target_tcin", "is", null)
      .order("added_at", { ascending: false });
    let warning: string | null = null;
    if (q.error) {
      const fb = await supabase
        .from("watchlist")
        .select("product_name, target_tcin, msrp")
        .not("target_tcin", "is", null)
        .order("added_at", { ascending: false });
      rows = (fb.data ?? null) as Record<string, unknown>[] | null;
      warning = "auto_buy column missing — run supabase/watchlist_add_auto_buy.sql in the Supabase SQL Editor";
    } else {
      rows = (q.data ?? null) as Record<string, unknown>[] | null;
    }
    targetsWarning = warning;
    targets = (rows ?? []).map((r) => ({
      tcin: String(r.target_tcin),
      name: String(r.product_name),
      msrp: (r.msrp as number | null) ?? null,
      autoBuy: Boolean(r.auto_buy),
    }));
  }

  return NextResponse.json({
    config,
    agentOnline: agentIsOnline(config),
    activeWindow: activeDropWindow(config),
    orders: orders ?? [],
    targets,
    targetsWarning,
  });
}
