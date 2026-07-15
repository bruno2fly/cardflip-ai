-- ============================================================
-- CardFlip AI — release alert preferences
-- Run this in the Supabase SQL Editor.
-- Stores per-set opt-in state for release alert emails.
-- ============================================================

create table if not exists public.release_alert_prefs (
  set_id     text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.release_alert_prefs enable row level security;

drop policy if exists "anon can read release_alert_prefs" on public.release_alert_prefs;
drop policy if exists "anon can insert release_alert_prefs" on public.release_alert_prefs;
drop policy if exists "anon can update release_alert_prefs" on public.release_alert_prefs;

create policy "anon can read release_alert_prefs"
  on public.release_alert_prefs for select using (true);

create policy "anon can insert release_alert_prefs"
  on public.release_alert_prefs for insert with check (true);

create policy "anon can update release_alert_prefs"
  on public.release_alert_prefs for update using (true) with check (true);
