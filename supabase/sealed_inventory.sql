-- ============================================================
-- CardFlip AI — sealed product inventory
-- Run this in the Supabase SQL Editor.
-- Same status-based single-table approach as public.cards:
--   owned → listed → sold
-- Rows reference the curated PRODUCTS list in lib/products.ts by product_id.
-- ============================================================

create table if not exists public.sealed_inventory (
  id             uuid primary key default gen_random_uuid(),
  product_id     text not null,           -- matches lib/products.ts ids (e.g. prismatic-etb)
  product_name   text not null,
  qty            integer not null default 1 check (qty > 0),
  bought_price   numeric(10,2) not null default 0,   -- per unit
  current_market numeric(10,2),                      -- snapshot at add time; UI shows live
  status         text not null default 'owned' check (status in ('owned','listed','sold')),
  platform       text check (platform in ('eBay','TCGPlayer','Mercari') or platform is null),
  asking_price   numeric(10,2),                      -- per unit
  listed_at      timestamptz,
  sold_price     numeric(10,2),                      -- per unit
  sold_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists sealed_inventory_status_idx  on public.sealed_inventory (status);
create index if not exists sealed_inventory_product_idx on public.sealed_inventory (product_id);

-- keep updated_at fresh (function shared with public.cards; safe to re-create)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists sealed_inventory_set_updated_at on public.sealed_inventory;
create trigger sealed_inventory_set_updated_at
  before update on public.sealed_inventory
  for each row execute function public.set_updated_at();

-- Row Level Security — single-user app on the anon key, same as schema.sql
alter table public.sealed_inventory enable row level security;

drop policy if exists "anon can read sealed_inventory"   on public.sealed_inventory;
drop policy if exists "anon can insert sealed_inventory" on public.sealed_inventory;
drop policy if exists "anon can update sealed_inventory" on public.sealed_inventory;
drop policy if exists "anon can delete sealed_inventory" on public.sealed_inventory;

create policy "anon can read sealed_inventory"   on public.sealed_inventory for select using (true);
create policy "anon can insert sealed_inventory" on public.sealed_inventory for insert with check (true);
create policy "anon can update sealed_inventory" on public.sealed_inventory for update using (true) with check (true);
create policy "anon can delete sealed_inventory" on public.sealed_inventory for delete using (true);
