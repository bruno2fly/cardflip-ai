-- ============================================================
-- CardFlip AI — decision engine verdicts
-- Run this in the Supabase SQL Editor.
-- One row per tracked product OR owned inventory lot, holding the latest
-- BUY/WAIT/SELL/AVOID call:
--   - curated PRODUCTS ids, e.g. "prismatic-etb"            (daily cron)
--   - discovered products,  e.g. "disc-<tcg_product_id>"    (daily cron)
--   - owned inventory lots, e.g. "inv-<sealed_inventory.id>" (on-demand,
--     computed from /sealed-inventory using real cost basis + market data)
-- A row is only ever written when the LLM call actually returned a clean,
-- parseable verdict — no row (or a stale computed_at) means "no analysis
-- available yet," which the UI must show honestly rather than fabricate.
-- ============================================================

create table if not exists public.product_verdicts (
  product_id      text primary key,       -- see id scheme above
  product_name    text not null,
  verdict          text not null check (verdict in ('BUY','WAIT','SELL','AVOID')),
  confidence       text not null check (confidence in ('High','Medium','Low')),
  reason           text not null,          -- 2-3 short bullet-style drivers, newline-separated
  computed_at      timestamptz not null default now(),
  inputs_snapshot  jsonb                   -- the real signals fed into the prompt, for debugging/trust
);

create index if not exists product_verdicts_computed_at_idx on public.product_verdicts (computed_at);

-- Row Level Security — same single-user anon pattern as the rest of the app
alter table public.product_verdicts enable row level security;

drop policy if exists "anon can read product_verdicts"   on public.product_verdicts;
drop policy if exists "anon can insert product_verdicts" on public.product_verdicts;
drop policy if exists "anon can update product_verdicts" on public.product_verdicts;

create policy "anon can read product_verdicts"   on public.product_verdicts for select using (true);
create policy "anon can insert product_verdicts" on public.product_verdicts for insert with check (true);
create policy "anon can update product_verdicts" on public.product_verdicts for update using (true) with check (true);
