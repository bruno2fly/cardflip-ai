-- ============================================================
-- CardFlip AI — user-editable sealed product watchlist
-- Run this in the Supabase SQL Editor.
-- Every row is verified against a real TCGPlayer sealed product before insert.
-- ============================================================

create table if not exists public.watchlist (
  id               uuid primary key default gen_random_uuid(),
  tcg_product_id   bigint not null,          -- verified TCGPlayer product id
  product_name     text not null,            -- verified TCGPlayer product name
  product_type     text,                     -- ETB / Booster Box / Booster Bundle / Premium Collection
  msrp             numeric(10,2),
  market_price     numeric(10,2),            -- verified snapshot at add time
  image_url        text,                     -- verified TCGPlayer CDN image
  target_tcin      bigint,                   -- optional pinned Target TCIN
  added_at         timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists watchlist_tcg_product_idx on public.watchlist (tcg_product_id);
create index if not exists watchlist_added_at_idx on public.watchlist (added_at desc);

-- keep updated_at fresh (function shared with public.cards; safe to re-create)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists watchlist_set_updated_at on public.watchlist;
create trigger watchlist_set_updated_at
  before update on public.watchlist
  for each row execute function public.set_updated_at();

-- Row Level Security — single-user app on the anon key, same as schema.sql
alter table public.watchlist enable row level security;

drop policy if exists "anon can read watchlist"   on public.watchlist;
drop policy if exists "anon can insert watchlist" on public.watchlist;
drop policy if exists "anon can update watchlist" on public.watchlist;
drop policy if exists "anon can delete watchlist" on public.watchlist;

create policy "anon can read watchlist"   on public.watchlist for select using (true);
create policy "anon can insert watchlist" on public.watchlist for insert with check (true);
create policy "anon can update watchlist" on public.watchlist for update using (true) with check (true);
create policy "anon can delete watchlist" on public.watchlist for delete using (true);
