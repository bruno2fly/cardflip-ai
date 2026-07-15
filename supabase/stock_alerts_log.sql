-- ============================================================
-- CardFlip AI — Best Buy stock state log
-- Run this in the Supabase SQL Editor.
-- One row per STATUS CHANGE per product; the latest row is the last known
-- state, so the 30-min cron only emails on a fresh flip to in-stock.
-- ============================================================

create table if not exists stock_alerts_log (
  id bigserial primary key,
  product_id text not null,
  product_name text,
  status text not null check (status in ('in-stock', 'out-of-stock', 'unknown')),
  sku text,
  created_at timestamptz default now()
);

create index if not exists stock_alerts_log_product_idx
  on stock_alerts_log (product_id, created_at desc);

alter table stock_alerts_log enable row level security;
create policy "anon read" on stock_alerts_log for select using (true);
create policy "anon insert" on stock_alerts_log for insert with check (true);
