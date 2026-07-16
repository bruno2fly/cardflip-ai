-- ============================================================
-- CardFlip AI — auto-discovered sealed products
-- Run this in the Supabase SQL Editor.
-- Fed by the daily /api/cron/discover-products job. A row is only ever
-- shown to users once status = 'verified' (real TCGPlayer product with a
-- live image + market price). Candidates that fail verification are kept
-- as 'rejected' so we never re-check the same junk twice.
-- ============================================================

create table if not exists public.discovered_products (
  id                      uuid primary key default gen_random_uuid(),
  candidate_name          text not null,              -- as extracted from the source
  source                  text not null,              -- 'tcgplayer-trending' | 'brave-search'
  source_signal           text,                       -- the query/snippet that surfaced it
  discovered_at           timestamptz not null default now(),
  verified                boolean not null default false,
  status                  text not null default 'candidate'
                            check (status in ('candidate','verified','rejected')),
  tcg_product_id          bigint unique,              -- null until verified
  verified_name           text,                       -- exact TCGPlayer product name
  product_type            text check (product_type in ('ETB','Booster Box','Booster Bundle','Premium Collection','Booster Pack') or product_type is null),
  msrp                    numeric(10,2),              -- assumed from product type at verification
  market_price            numeric(10,2),              -- TCGPlayer market at verification time
  verification_checked_at timestamptz
);

create index if not exists discovered_products_status_idx on public.discovered_products (status);
create unique index if not exists discovered_products_name_idx
  on public.discovered_products (lower(candidate_name));

-- Row Level Security — same single-user anon pattern as sealed_inventory.sql
alter table public.discovered_products enable row level security;

drop policy if exists "anon can read discovered_products"   on public.discovered_products;
drop policy if exists "anon can insert discovered_products" on public.discovered_products;
drop policy if exists "anon can update discovered_products" on public.discovered_products;

create policy "anon can read discovered_products"   on public.discovered_products for select using (true);
create policy "anon can insert discovered_products" on public.discovered_products for insert with check (true);
create policy "anon can update discovered_products" on public.discovered_products for update using (true) with check (true);
