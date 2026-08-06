-- ============================================================
-- CardFlip AI — price_history (real market-price time series)
-- Run this in the Supabase SQL Editor.
--
-- Every time lib/sealedPricing.ts successfully fetches a REAL market price
-- for a product (tcgapi.dev or the TCGPlayer pricepoints fallback), it
-- appends one row here. lib/priceTrend.ts then reads the last 14 days per
-- product to compute an ACTUAL momentum tag (RISING / FALLING / STABLE +
-- percent change) instead of the old hand-typed "🔥 HOT" strings.
--
-- Append-only: the app never updates or deletes rows, so there are only
-- read + insert policies. Only real fetched prices are ever inserted —
-- never nulls, never MSRP guesses.
-- ============================================================

create table if not exists public.price_history (
  id          bigint generated always as identity primary key,
  product_id  text        not null,          -- SealedProduct.id (e.g. "prismatic-etb", "disc-<tcgId>", "inv-<uuid>")
  price       numeric      not null,          -- real fetched market price; never null
  source      text,                            -- 'tcgapi' | 'tcgplayer-est' (matches lib/sealedPricing.ts SealedPrice.source)
  checked_at  timestamptz  not null default now()
);

-- Trend queries always filter by product_id and a recent time window, then
-- read newest→oldest — this composite index serves exactly that access path.
create index if not exists price_history_product_time_idx
  on public.price_history (product_id, checked_at desc);

-- Row Level Security — same single-user anon pattern as the rest of the app.
-- No update/delete policies: the table is an immutable append-only log.
alter table public.price_history enable row level security;

drop policy if exists "anon can read price_history"   on public.price_history;
drop policy if exists "anon can insert price_history" on public.price_history;

create policy "anon can read price_history"   on public.price_history for select using (true);
create policy "anon can insert price_history" on public.price_history for insert with check (true);
