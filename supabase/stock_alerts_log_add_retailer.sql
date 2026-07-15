-- ============================================================
-- CardFlip AI — migration: per-retailer stock tracking
-- Run this in the Supabase SQL Editor (after stock_alerts_log.sql).
-- Existing rows were all Best Buy checks, so they default to 'bestbuy'.
-- ============================================================

alter table stock_alerts_log
  add column if not exists retailer text not null default 'bestbuy'
  check (retailer in ('bestbuy', 'target'));

create index if not exists stock_alerts_log_retailer_idx
  on stock_alerts_log (retailer, product_id, created_at desc);
