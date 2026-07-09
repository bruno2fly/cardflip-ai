-- ============================================================
-- CardFlip AI — price alert log
-- Run this in the Supabase SQL Editor (after schema.sql).
-- Stores each alert sent so the hourly scan doesn't spam Jason:
-- a card is only re-alerted when its price moves > 5%.
-- ============================================================

create table if not exists public.alerts_log (
  id            uuid primary key default gen_random_uuid(),
  card_id       text not null,          -- Pokemon TCG API card id (e.g. swsh7-215)
  card_name     text not null,
  alerted_price numeric(10,2) not null, -- live market price at alert time
  max_buy       numeric(10,2),          -- max buy price at alert time
  created_at    timestamptz not null default now()
);

create index if not exists alerts_log_card_id_idx    on public.alerts_log (card_id, created_at desc);

alter table public.alerts_log enable row level security;

drop policy if exists "anon can read alerts_log"   on public.alerts_log;
drop policy if exists "anon can insert alerts_log" on public.alerts_log;

create policy "anon can read alerts_log"   on public.alerts_log for select using (true);
create policy "anon can insert alerts_log" on public.alerts_log for insert with check (true);
