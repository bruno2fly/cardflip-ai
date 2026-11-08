import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getBotConfig, listBotOrders, agentIsOnline, activeDropWindow, listBots } from "@/lib/bot";

export const dynamic = "force-dynamic";

/**
 * Buy Bot page snapshot — one GET the /bot page (and any future status
 * pill) can poll: config (arm + heartbeat), recent orders, and the
 * watchlist rows that have a Target TCIN so each can show/toggle auto-buy.
 */

export async function GET() {
  const [config, orders, bots] = await Promise.all([getBotConfig(), listBotOrders(100), listBots()]);

  let targets: Array<{
    sku?: string | null;
    retailer?: string | null;
    tcin: string;
    name: string;
    msrp: number | null;
    autoBuy: boolean;
    imageUrl: string | null;
    url: string | null;
  }> = [];
  let targetsWarning: string | null = null;

  if (supabase) {
    // Full column list first; if the auto_buy migration hasn't been run yet,
    // fall back to the base columns and warn instead of breaking the page.
    let rows: Record<string, unknown>[] | null = null;
    const q = await supabase
      .from("watchlist")
      .select("product_name, target_tcin, msrp, auto_buy, image_url, target_url, retailer, retailer_sku")
      .or("target_tcin.not.is.null,retailer.not.is.null")
      .order("added_at", { ascending: false });
    let warning: string | null = null;
    if (q.error) {
      const fb = await supabase
        .from("watchlist")
        .select("product_name, target_tcin, msrp, image_url, target_url")
        .not("target_tcin", "is", null)
        .order("added_at", { ascending: false });
      rows = (fb.data ?? null) as Record<string, unknown>[] | null;
      warning = "auto_buy column missing — run supabase/watchlist_add_auto_buy.sql in the Supabase SQL Editor";
    } else {
      rows = (q.data ?? null) as Record<string, unknown>[] | null;
    }
    targetsWarning = warning;
    targets = (rows ?? []).map((r) => ({
      tcin: r.target_tcin != null ? String(r.target_tcin) : String(r.retailer_sku ?? ""),
      sku: (r.retailer_sku as string | null) ?? null,
      retailer: (r.retailer as string | null) ?? "target",
      name: String(r.product_name),
      msrp: (r.msrp as number | null) ?? null,
      autoBuy: Boolean(r.auto_buy),
      imageUrl: (r.image_url as string | null) ?? null,
      url: (r.target_url as string | null) ?? null,
    }));
  }

  return NextResponse.json({
    config,
    agentOnline: agentIsOnline(config),
    activeWindow: activeDropWindow(config),
    orders: orders ?? [],
    targets,
    targetsWarning,
    bots,
  });
}
