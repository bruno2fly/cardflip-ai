-- ============================================================
-- CardFlip AI — allow Target-catalog products on the watchlist
-- Run this ONCE in the Supabase SQL Editor. Purely additive & idempotent:
-- existing (TCGPlayer-verified) rows are untouched, existing behavior unchanged.
--
-- WHY: the watchlist was TCGPlayer-centric — tcg_product_id was NOT NULL, so a
-- Target product that only has a TCIN (most of the 639 in the scraped Target
-- catalog: tins, promos, Target-exclusive SKUs) could not be tracked. This lets
-- Jason 1-click "Track this" on any Target-catalog product and have it flow
-- through the EXISTING stock-check + alert pipeline (the cron already reads
-- target_tcin off each watchlist row). No parallel pipeline, no alert changes.
-- ============================================================

-- 1) tcg_product_id becomes optional. Postgres already allows many NULLs in the
--    existing unique index on (tcg_product_id), so TCGPlayer-verified rows keep
--    their one-row-per-product guarantee while Target-only rows leave it NULL.
alter table public.watchlist
  alter column tcg_product_id drop not null;

-- 2) Provenance columns so the UI/data layer can tell a Target-sourced row apart
--    and keep the real direct product URL. Defaulting source to 'tcgplayer'
--    correctly labels every pre-existing row.
alter table public.watchlist
  add column if not exists source text not null default 'tcgplayer';

alter table public.watchlist
  add column if not exists target_url text;

-- 3) Index target_tcin for fast "is this TCIN already tracked?" lookups. NOT
--    unique on purpose: uniqueness is enforced in application code (a friendly
--    "already tracking" message) so this migration can never fail on any
--    pre-existing duplicate TCIN, and a curated product + a Target-catalog row
--    that happen to share a TCIN never hard-conflict at the DB layer.
create index if not exists watchlist_target_tcin_idx
  on public.watchlist (target_tcin)
  where target_tcin is not null;
