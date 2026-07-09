-- ============================================================
-- CardFlip AI — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- ============================================================

-- One table drives all three pages:
--   Inventory : every row (your collection)
--   Listings  : rows where status IN ('active','sold')
--   Scanner   : every row (live prices come from /api/prices)
create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  set_name     text,
  card_number  text,
  condition    text not null default 'Raw NM',
  bought       numeric(10,2) not null default 0,   -- what you paid
  current      numeric(10,2) not null default 0,   -- current market value
  card_image   text,                               -- hi-res image URL (pokemontcg.io)
  emoji        text not null default '🃏',         -- fallback when no image

  -- listing fields (null / defaults while the card is just "owned")
  status       text not null default 'owned' check (status in ('owned','active','sold')),
  platform     text check (platform in ('eBay','TCGPlayer','Mercari') or platform is null),
  asking       numeric(10,2),
  listed_at    timestamptz,
  watchers     integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists cards_status_idx     on public.cards (status);
create index if not exists cards_created_at_idx on public.cards (created_at desc);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- Single-user app using the anon key from the browser, so we
-- allow full access to the anon role. If you later add Supabase
-- Auth, replace these with per-user policies (e.g. user_id = auth.uid()).
-- ------------------------------------------------------------
alter table public.cards enable row level security;

drop policy if exists "anon can read cards"   on public.cards;
drop policy if exists "anon can insert cards" on public.cards;
drop policy if exists "anon can update cards" on public.cards;
drop policy if exists "anon can delete cards" on public.cards;

create policy "anon can read cards"   on public.cards for select using (true);
create policy "anon can insert cards" on public.cards for insert with check (true);
create policy "anon can update cards" on public.cards for update using (true) with check (true);
create policy "anon can delete cards" on public.cards for delete using (true);

-- ------------------------------------------------------------
-- Seed data (matches the old mock data in lib/data.js)
-- Safe to delete this block if you want to start empty.
-- ------------------------------------------------------------
insert into public.cards
  (name, set_name, card_number, condition, bought, current, emoji, card_image, status, platform, asking, listed_at, watchers)
values
  ('Umbreon VMAX Alt Art',   'Evolving Skies',      '215/203', 'PSA 10', 280, 420,  '🌙', 'https://images.pokemontcg.io/swsh7/215_hires.png',  'active', 'TCGPlayer', 412,  now() - interval '3 days',  12),
  ('Charizard ex',           'Paldea Evolved',      '199/193', 'PSA 9',  95,  140,  '🔥', 'https://images.pokemontcg.io/sv2/199_hires.png',    'active', 'Mercari',   138,  now() - interval '15 days', 4),
  ('Lugia V Alt Art',        'Silver Tempest',      '186/195', 'Raw NM', 45,  62,   '🌊', 'https://images.pokemontcg.io/swsh12/186_hires.png', 'active', 'Mercari',   60,   now() - interval '1 day',   3),
  ('Base Set Charizard',     'Base Set 1999',       '4/102',   'PSA 6',  900, 1200, '🐉', 'https://images.pokemontcg.io/base1/4_hires.png',    'active', 'eBay',      1199, now() - interval '7 days',  28),
  ('Rayquaza VMAX Alt Art',  'Evolving Skies',      '218/203', 'PSA 10', 310, 390,  '⚡', 'https://images.pokemontcg.io/swsh7/218_hires.png',  'owned',  null, null, null, 0),
  ('Pikachu VMAX Rainbow',   'Vivid Voltage',       '188/185', 'PSA 9',  75,  95,   '⚡', 'https://images.pokemontcg.io/swsh4/188_hires.png',  'active', 'TCGPlayer', 95,   now() - interval '4 days',  7),
  ('Mewtwo GX Rainbow',      'Shining Legends',     '78/73',   'Raw NM', 28,  38,   '🔮', 'https://images.pokemontcg.io/sm35/78_hires.png',    'owned',  null, null, null, 0),
  ('Gengar VMAX Alt Art',    'Fusion Strike',       '271/264', 'PSA 10', 145, 185,  '👻', 'https://images.pokemontcg.io/swsh8/271_hires.png',  'active', 'eBay',      185,  now() - interval '18 days', 6),
  ('Mew VMAX Alt Art',       'Fusion Strike',       '269/264', 'Raw NM', 32,  48,   '🌸', 'https://images.pokemontcg.io/swsh8/269_hires.png',  'owned',  null, null, null, 0),
  ('Blaziken VMAX Alt Art',  'Chilling Reign',      '200/198', 'PSA 9',  88,  110,  '🔥', 'https://images.pokemontcg.io/swsh6/200_hires.png',  'sold',   'eBay',      225,  now(),                      0),
  ('Snorlax VMAX Rainbow',   'Sword & Shield Base', '206/202', 'Raw NM', 22,  29,   '💤', 'https://images.pokemontcg.io/swsh1/206_hires.png',  'owned',  null, null, null, 0),
  ('Dialga VSTAR Gold',      'Astral Radiance',     '214/189', 'Raw NM', 18,  25,   '🔵', 'https://images.pokemontcg.io/swsh10/214_hires.png', 'owned',  null, null, null, 0),
  ('Arceus VSTAR Rainbow',   'Brilliant Stars',     '184/172', 'Raw NM', 35,  42,   '⭐', 'https://images.pokemontcg.io/swsh9/184_hires.png',  'owned',  null, null, null, 0),
  ('Giratina V Alt Art',     'Lost Origin',         '182/196', 'PSA 10', 195, 274,  '🌀', 'https://images.pokemontcg.io/swsh11/182_hires.png', 'active', 'TCGPlayer', 274,  now() - interval '2 days',  9);
