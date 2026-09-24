/**
 * CardFlip AI — Buy Bot data layer (platform side).
 *
 * Shapes and helpers around public.bot_orders / public.bot_config
 * (see supabase/bot_orders.sql). The actual browser buying runs on the
 * Mac mini (DropBot); this file only reads/writes the Supabase queue the
 * agent polls.
 */

import { supabase } from "@/lib/supabase";

export type BotOrderStatus = "queued" | "running" | "ordered" | "failed" | "cancelled";
export type BotOrderSource = "auto" | "manual";

export type BotOrder = {
  id: string;
  tcin: string;
  productName: string;
  retailer: string;
  status: BotOrderStatus;
  source: BotOrderSource;
  price: number | null;
  error: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
};

/** One fast-poll window (Stellar-style dynamic delay). Local time, no offset. */
export type DropWindow = {
  start: string;
  end: string;
  intervalSec: number;
};

export type BotConfig = {
  armed: boolean;
  agentHeartbeat: string | null;
  agentVersion: string | null;
  agentMachine: string | null;
  agentProfileReady: boolean;
  dropWindows: DropWindow[];
  updatedAt: string;
};

type BotOrderRow = {
  id: string;
  tcin: string;
  product_name: string;
  retailer: string;
  status: string;
  source: string;
  price: number | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

const ORDER_COLUMNS =
  "id, tcin, product_name, retailer, status, source, price, error, created_at, claimed_at, finished_at";

function orderFromRow(row: BotOrderRow): BotOrder {
  return {
    id: row.id,
    tcin: row.tcin,
    productName: row.product_name,
    retailer: row.retailer,
    status: row.status as BotOrderStatus,
    source: row.source as BotOrderSource,
    price: row.price,
    error: row.error,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

export async function listBotOrders(limit = 100): Promise<BotOrder[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("bot_orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return (data ?? []).map(orderFromRow);
}

export async function queueBotOrder(input: {
  tcin: string | number;
  productName?: string;
  price?: number | null;
  source?: BotOrderSource;
}): Promise<BotOrder | null> {
  if (!supabase) return null;
  const tcin = String(input.tcin).trim();
  if (!tcin) return null;
  const { data, error } = await supabase
    .from("bot_orders")
    .insert({
      tcin,
      product_name: input.productName ?? "",
      price: input.price ?? null,
      source: input.source ?? "manual",
      status: "queued",
    })
    .select(ORDER_COLUMNS)
    .single();
  if (error) return null;
  return orderFromRow(data as BotOrderRow);
}

export async function getBotConfig(): Promise<BotConfig | null> {
  if (!supabase) return null;
  // Full column set first; if the agent_profile_ready column hasn't been
  // added yet (migration pending), fall back to the base columns so the
  // page degrades gracefully instead of losing the whole config card.
  let data: Record<string, unknown> | null = null;
  const q = await supabase
    .from("bot_config")
    .select("armed, agent_heartbeat, agent_version, agent_machine, agent_profile_ready, drop_windows, updated_at")
    .eq("id", 1)
    .single();
  if (q.error) {
    const fb = await supabase
      .from("bot_config")
      .select("armed, agent_heartbeat, agent_version, agent_machine, updated_at")
      .eq("id", 1)
      .single();
    data = (fb.data ?? null) as Record<string, unknown> | null;
  } else {
    data = (q.data ?? null) as Record<string, unknown> | null;
  }
  if (!data) return null;
  const row = data as {
    armed: boolean;
    agent_heartbeat: string | null;
    agent_version: string | null;
    agent_machine: string | null;
    agent_profile_ready?: boolean | null;
    drop_windows?: unknown;
    updated_at: string;
  };
  const windows = Array.isArray(row.drop_windows) ? row.drop_windows : [];
  return {
    armed: row.armed,
    agentHeartbeat: row.agent_heartbeat,
    agentVersion: row.agent_version,
    agentMachine: row.agent_machine,
    agentProfileReady: row.agent_profile_ready ?? false,
    dropWindows: windows
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .map((w) => ({
        start: String(w.start ?? ""),
        end: String(w.end ?? ""),
        intervalSec: Number(w.interval_sec ?? 15) || 15,
      }))
      .filter((w) => w.start && w.end),
    updatedAt: row.updated_at,
  };
}

export async function setBotArmed(armed: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("bot_config").update({ armed }).eq("id", 1);
  return !error;
}

/** The drop window covering NOW (server clock, same TZ as the browser). */
export function activeDropWindow(cfg: BotConfig | null): DropWindow | null {
  if (!cfg) return null;
  const now = Date.now();
  for (const w of cfg.dropWindows) {
    const s = new Date(w.start).getTime();
    const e = new Date(w.end).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && s <= now && now <= e) return w;
  }
  return null;
}

/** Replace the whole drop-window list. Callers validate before calling. */
export async function setDropWindows(windows: DropWindow[]): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("bot_config")
    .update({ drop_windows: windows.map((w) => ({ start: w.start, end: w.end, interval_sec: w.intervalSec })) })
    .eq("id", 1);
  return !error;
}

/** Bot is considered ONLINE when its heartbeat is fresher than this. */
export const BOT_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function agentIsOnline(cfg: BotConfig | null): boolean {
  if (!cfg?.agentHeartbeat) return false;
  return Date.now() - new Date(cfg.agentHeartbeat).getTime() < BOT_ONLINE_WINDOW_MS;
}
