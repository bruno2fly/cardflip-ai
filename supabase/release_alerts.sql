-- ============================================================
-- CardFlip AI — release alert log
-- Run this in the Supabase SQL Editor.
-- Each upcoming set is emailed exactly once; this table remembers which.
-- ============================================================

create table if not exists release_alerts_log (
  id bigserial primary key,
  set_id text not null unique,
  set_name text,
  release_date date,
  alerted_at timestamptz default now()
);
alter table release_alerts_log enable row level security;
create policy "anon read" on release_alerts_log for select using (true);
create policy "anon insert" on release_alerts_log for insert with check (true);
