-- ============================================================
-- CardFlip AI — watchlist auto-buy flag (Buy Bot)
-- Run this in the Supabase SQL Editor after bot_orders.sql.
--
-- Adds auto_buy to the existing watchlist: when true, the Mac mini
-- DropBot treats that row as a purchase target (not just an alert).
-- The Buy Bot page (/bot) toggles this per item.
-- ============================================================

alter table public.watchlist
  add column if not exists auto_buy boolean not null default false;

create index if not exists watchlist_auto_buy_idx on public.watchlist (auto_buy) where auto_buy;
