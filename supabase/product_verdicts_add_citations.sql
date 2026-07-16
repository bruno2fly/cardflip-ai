-- ============================================================
-- CardFlip AI — migration: verdict citations (Phase 2.5)
-- Run this in the Supabase SQL Editor (after product_verdicts.sql).
--
-- Sonar does its own live web search when reasoning; its response includes
-- the sources it used (citations / search_results). We store them so every
-- claim in a verdict's reason text is traceable — same audit standard as
-- inputs_snapshot. Array of { url, title? } objects; empty array = the
-- model reported no external sources.
-- ============================================================

alter table public.product_verdicts
  add column if not exists citations jsonb not null default '[]'::jsonb;
