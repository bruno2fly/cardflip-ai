import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Shared Supabase client. Null when env vars are missing so pages can
 * gracefully fall back (mock data / localStorage) instead of crashing.
 * Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

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

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
