-- ============================================================
-- CardFlip AI — checkout profile (manual-checkout speed prep)
-- Run this in the Supabase SQL Editor.
--
-- A SINGLE row (id = 1) holding Jason's own shipping/billing reference info,
-- so the Sealed Products page can show a "Quick Buy Info" panel he can
-- copy-paste fast into a retailer's checkout form the moment an alert fires.
--
-- ⚠️ NEVER store payment card data here. No card number, no CVV, no expiry.
-- This is name + address + contact only — the stuff that's tedious to retype,
-- not anything sensitive enough to be a liability if the row leaked. The app
-- has no column for card data and must never add one.
-- ============================================================

create table if not exists public.checkout_profile (
  id            integer primary key default 1 check (id = 1),  -- singleton row
  full_name     text,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  city          text,
  state_region  text,
  postal_code   text,
  country       text not null default 'US',
  notes         text,           -- free-form (e.g. "use PayPal", "gift receipt") — never card data
  updated_at    timestamptz not null default now()
);

-- Row Level Security — same single-user anon pattern as the rest of the app.
alter table public.checkout_profile enable row level security;

drop policy if exists "anon can read checkout_profile"   on public.checkout_profile;
drop policy if exists "anon can insert checkout_profile" on public.checkout_profile;
drop policy if exists "anon can update checkout_profile" on public.checkout_profile;

create policy "anon can read checkout_profile"   on public.checkout_profile for select using (true);
create policy "anon can insert checkout_profile" on public.checkout_profile for insert with check (true);
create policy "anon can update checkout_profile" on public.checkout_profile for update using (true) with check (true);
