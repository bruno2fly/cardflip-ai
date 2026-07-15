-- ============================================================
-- CardFlip AI — early set-reveal intel log (Serebii scraping)
-- Run this in the Supabase SQL Editor.
-- One row per revealed set; unique set_name means each reveal is
-- emailed exactly once, ever.
-- ============================================================

create table if not exists leak_intel_log (
  id bigserial primary key,
  set_name text not null unique,     -- normalized (lowercase)
  display_name text,
  release_date text,                 -- as printed by the source, may be null
  source text not null default 'serebii',
  source_url text,
  found_at timestamptz default now()
);

alter table leak_intel_log enable row level security;
create policy "anon read" on leak_intel_log for select using (true);
create policy "anon insert" on leak_intel_log for insert with check (true);
