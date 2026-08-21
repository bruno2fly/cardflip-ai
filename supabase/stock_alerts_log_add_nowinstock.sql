-- ============================================================
-- CardFlip AI — migration: NowInStock source + open retailer names
-- Run this in the Supabase SQL Editor after stock_alerts_log_add_retailer.sql.
-- Existing rows remain source='direct'; NowInStock rows use the retailer name
-- shown by the feed and source='nowinstock'.
-- ============================================================

alter table stock_alerts_log
  add column if not exists source text not null default 'direct';

alter table stock_alerts_log
  drop constraint if exists stock_alerts_log_retailer_check;

alter table stock_alerts_log
  drop constraint if exists stock_alerts_log_source_check;

alter table stock_alerts_log
  add constraint stock_alerts_log_source_check
  check (source in ('direct', 'nowinstock'));

create index if not exists stock_alerts_log_source_retailer_idx
  on stock_alerts_log (source, retailer, product_id, created_at desc);
