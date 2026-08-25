-- ============================================================
-- CardFlip AI — multi-user accounts (Supabase Auth + per-user RLS)
--
-- Turns the app from a single shared workspace into real separate accounts:
-- each user gets their OWN single-card inventory, sealed inventory, listings,
-- and Quick Buy (checkout) profile. Market-wide data — the product catalog,
-- live prices, price-history trends, release/leak intel, decision verdicts —
-- stays SHARED (those tables keep their `using (true)` policies; nothing here
-- touches them).
--
-- ┌── RUN ORDER — READ THIS ─────────────────────────────────────────────────┐
-- │ 1. Supabase Dashboard → Authentication → Providers → enable **Email**.    │
-- │    (Optional: turn OFF "Allow new users to sign up" — the app has no      │
-- │    public signup form, so accounts are invite-only / created by you.)     │
-- │ 2. Authentication → Users → **Add user** → create YOUR account            │
-- │    (email + password) and the second user's account. Then open your own   │
-- │    user row and copy its **User UID** (a uuid).                           │
-- │ 3. Paste that uuid into the two spots marked <YOUR_USER_UID> below.       │
-- │ 4. Run this whole file in the SQL Editor.                                 │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Personal tables affected: cards, sealed_inventory, checkout_profile.
-- ⚠️ checkout_profile is RECREATED (it was a single shared row) — you'll just
--    re-enter your Quick Buy address once after this runs.
-- ============================================================

-- ── cards (single-card inventory + listings) ────────────────────────────────
alter table public.cards
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- claim all existing rows for your account (they have no owner yet, so without
-- this they'd become invisible once the per-user policies below take over)
update public.cards set user_id = '<YOUR_USER_UID>' where user_id is null;
alter table public.cards alter column user_id set not null;
create index if not exists cards_user_idx on public.cards (user_id);

alter table public.cards enable row level security;
drop policy if exists "anon can read cards"   on public.cards;
drop policy if exists "anon can insert cards" on public.cards;
drop policy if exists "anon can update cards" on public.cards;
drop policy if exists "anon can delete cards" on public.cards;
drop policy if exists "cards are public"      on public.cards;
drop policy if exists "own cards select" on public.cards;
drop policy if exists "own cards insert" on public.cards;
drop policy if exists "own cards update" on public.cards;
drop policy if exists "own cards delete" on public.cards;
create policy "own cards select" on public.cards for select using (auth.uid() = user_id);
create policy "own cards insert" on public.cards for insert with check (auth.uid() = user_id);
create policy "own cards update" on public.cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own cards delete" on public.cards for delete using (auth.uid() = user_id);

-- ── sealed_inventory (sealed product inventory + listings) ───────────────────
alter table public.sealed_inventory
  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

update public.sealed_inventory set user_id = '<YOUR_USER_UID>' where user_id is null;
alter table public.sealed_inventory alter column user_id set not null;
create index if not exists sealed_inventory_user_idx on public.sealed_inventory (user_id);

alter table public.sealed_inventory enable row level security;
drop policy if exists "anon can read sealed_inventory"   on public.sealed_inventory;
drop policy if exists "anon can insert sealed_inventory" on public.sealed_inventory;
drop policy if exists "anon can update sealed_inventory" on public.sealed_inventory;
drop policy if exists "anon can delete sealed_inventory" on public.sealed_inventory;
drop policy if exists "own sealed select" on public.sealed_inventory;
drop policy if exists "own sealed insert" on public.sealed_inventory;
drop policy if exists "own sealed update" on public.sealed_inventory;
drop policy if exists "own sealed delete" on public.sealed_inventory;
create policy "own sealed select" on public.sealed_inventory for select using (auth.uid() = user_id);
create policy "own sealed insert" on public.sealed_inventory for insert with check (auth.uid() = user_id);
create policy "own sealed update" on public.sealed_inventory for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sealed delete" on public.sealed_inventory for delete using (auth.uid() = user_id);

-- ── checkout_profile (Quick Buy shipping/billing reference) ──────────────────
-- Was a single shared row (id = 1). Recreate it keyed by user so each account
-- keeps its own. Still NEVER holds payment-card data. You re-enter your address
-- once in the app after this runs.
drop table if exists public.checkout_profile;
create table public.checkout_profile (
  user_id       uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  full_name     text,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  city          text,
  state_region  text,
  postal_code   text,
  country       text not null default 'US',
  notes         text,           -- free-form (e.g. "use PayPal") — never card data
  updated_at    timestamptz not null default now()
);
alter table public.checkout_profile enable row level security;
create policy "own checkout select" on public.checkout_profile for select using (auth.uid() = user_id);
create policy "own checkout insert" on public.checkout_profile for insert with check (auth.uid() = user_id);
create policy "own checkout update" on public.checkout_profile for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── done ─────────────────────────────────────────────────────────────────────
-- After this: sign in as either account and you'll only ever see your own
-- inventory/listings/profile. The market data (prices, trends, releases,
-- verdicts) is the same for everyone, as intended.
