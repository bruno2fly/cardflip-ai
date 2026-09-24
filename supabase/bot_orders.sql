-- ============================================================
-- CardFlip AI — Buy Bot tables (platform side of DropBot)
-- Run this in the Supabase SQL Editor.
--
-- Two pieces:
--   bot_orders  → the order queue: what the bot is buying / bought / failed
--   bot_config  → single-row control plane: master arm switch + the
--                 bot agent's heartbeat (when the Mac mini checked in last)
--
-- The browser execution itself NEVER runs here. The Mac mini (DropBot,
-- Playwright + real Chrome on the home IP) polls these tables and does
-- the buying. Supabase is the messenger between platform and machine.
--
-- ⚠️ Card data never touches this schema. The buyer pays with the card
-- saved in the Target account wallet, exactly like checkout_profile.sql's
-- no-card-data rule.
-- ============================================================

create table if not exists public.bot_orders (
  id            uuid primary key default gen_random_uuid(),
  tcin          text not null,                    -- Target TCIN being bought
  product_name  text not null default '',         -- display name
  retailer      text not null default 'target',
  status        text not null default 'queued'
                check (status in ('queued','running','ordered','failed','cancelled')),
  source        text not null default 'auto'
                check (source in ('auto','manual')),   -- auto = bot detected the drop itself
  price         numeric(10,2),                    -- price observed/paid at buy time
  error         text,                             -- failure reason, if status = failed
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,                       -- when the agent picked it up
  finished_at   timestamptz                       -- when it reached ordered/failed
);

create index if not exists bot_orders_created_idx  on public.bot_orders (created_at desc);
create index if not exists bot_orders_status_idx   on public.bot_orders (status);

-- Single-row control plane. id is pinned to 1, same singleton trick as
-- checkout_profile.
create table if not exists public.bot_config (
  id              integer primary key default 1 check (id = 1),
  armed           boolean not null default false,  -- master kill switch: no buying while false
  agent_heartbeat timestamptz,                     -- last /api/bot/agent heartbeat from the mini
  agent_version   text,                            -- DropBot version string
  agent_machine   text,                            -- e.g. "bruno’s Mac mini (Mac mini M4)"
  agent_profile_ready boolean not null default false,  -- encrypted checkout profile present on the mini
  drop_windows    jsonb not null default '[]'::jsonb,   -- [{start,end,interval_sec}] local-time fast-poll windows
  -- zero-knowledge checkout profile (see /bot page): the browser encrypts
  -- card data with the mini's RSA public key; ONLY ciphertext ever lands
  -- here. profile_masked is display-only (last4 + name + expiry).
  profile_pubkey      text,          -- PEM public key published by the mini
  profile_ciphertext  text,          -- browser-encrypted profile JSON awaiting pickup
  profile_masked      text,          -- e.g. "Visa 4242 · 12/30 · Bruno" (set by the mini after consuming)
  profile_updated_at  timestamptz,
  updated_at      timestamptz not null default now()
);

-- If bot_config already exists from an earlier run of this file, make the
-- new heartbeat column available without a full teardown:
alter table public.bot_config
  add column if not exists agent_profile_ready boolean not null default false;
alter table public.bot_config
  add column if not exists drop_windows jsonb not null default '[]'::jsonb;
alter table public.bot_config
  add column if not exists profile_pubkey text;
alter table public.bot_config
  add column if not exists profile_ciphertext text;
alter table public.bot_config
  add column if not exists profile_masked text;
alter table public.bot_config
  add column if not exists profile_updated_at timestamptz;

insert into public.bot_config (id) values (1) on conflict (id) do nothing;

-- Row Level Security — single-user anon pattern, same as the rest of the app.
alter table public.bot_orders enable row level security;
alter table public.bot_config enable row level security;

drop policy if exists "anon can read bot_orders"   on public.bot_orders;
drop policy if exists "anon can insert bot_orders" on public.bot_orders;
drop policy if exists "anon can update bot_orders" on public.bot_orders;
drop policy if exists "anon can delete bot_orders" on public.bot_orders;
create policy "anon can read bot_orders"   on public.bot_orders for select using (true);
create policy "anon can insert bot_orders" on public.bot_orders for insert with check (true);
create policy "anon can update bot_orders" on public.bot_orders for update using (true) with check (true);
create policy "anon can delete bot_orders" on public.bot_orders for delete using (true);

drop policy if exists "anon can read bot_config"   on public.bot_config;
drop policy if exists "anon can insert bot_config" on public.bot_config;
drop policy if exists "anon can update bot_config" on public.bot_config;
create policy "anon can read bot_config"   on public.bot_config for select using (true);
create policy "anon can insert bot_config" on public.bot_config for insert with check (true);
create policy "anon can update bot_config" on public.bot_config for update using (true) with check (true);
