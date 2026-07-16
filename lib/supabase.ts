import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Shared Supabase client. Null when env vars are missing so pages can
 * gracefully fall back (mock data / localStorage) instead of crashing.
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
 */
/**
 * IMPORTANT: the custom fetch below is load-bearing. Next.js 14 caches
 * fetch() GETs in its persistent data cache — including supabase-js
 * .select() calls — even in routes marked `dynamic = "force-dynamic"`.
 * Root cause of the compute-verdicts bug where the freshness query
 * replayed its first-ever (empty) response forever and the cron
 * recomputed the same 12 products on every run. cache:"no-store" opts
 * every Supabase request out of that cache, server and client alike.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        global: {
          fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        },
      })
    : null;

export type CardStatus = "owned" | "active" | "sold";

/** Row shape of the public.cards table (see supabase/schema.sql) */
export type DbCard = {
  id: string;
  name: string;
  set_name: string | null;
  card_number: string | null;
  condition: string;
  bought: number;
  current: number;
  card_image: string | null;
  emoji: string;
  status: CardStatus;
  platform: string | null;
  asking: number | null;
  listed_at: string | null;
  watchers: number;
  created_at: string;
  updated_at: string;
};

export type SealedStatus = "owned" | "listed" | "sold";

/** Row shape of the public.sealed_inventory table (see supabase/sealed_inventory.sql) */
export type DbSealedItem = {
  id: string;
  product_id: string;
  product_name: string;
  qty: number;
  bought_price: number;
  current_market: number | null;
  status: SealedStatus;
  platform: string | null;
  asking_price: number | null;
  listed_at: string | null;
  sold_price: number | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
};

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
