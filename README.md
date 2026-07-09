# CardFlip AI

Pokemon card flip tracker built with Next.js 14 + Tailwind, backed by Supabase and live Pokemon TCG / TCGPlayer data.

## Features

- **Inventory** — search the Pokemon TCG database (`api.pokemontcg.io`) to add cards with real images; name, set, number, and image auto-fill, and the current value pre-fills from the live TCGPlayer market price.
- **Market Scanner** — pulls live TCGPlayer low/market/high prices for every card via `/api/prices` and flags flip opportunities vs your cost.
- **Listings** — active/sold listings stored in Supabase with mark-sold / relist actions.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run the contents of [`supabase/schema.sql`](supabase/schema.sql) — this creates the `cards` table (with seed data) and permissive RLS policies for the anon key.
3. Copy `.env.local.example` to `.env.local` and fill in your project's URL and anon key (Project Settings → API):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Without these env vars the app still runs, falling back to demo data / localStorage, and shows a banner on each page.

### 3. (Optional) Pokemon TCG API key

Get a free key at [dev.pokemontcg.io](https://dev.pokemontcg.io) and set `POKEMONTCG_API_KEY` in `.env.local` for higher rate limits on card search and price lookups.

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## API

### `GET /api/prices?name=CARDNAME[&set=SET][&number=215/203]`

Returns live TCGPlayer prices from the Pokemon TCG API `tcgplayer` field:

```json
{
  "query": "Umbreon VMAX",
  "matched": { "id": "swsh7-215", "name": "Umbreon VMAX", "set": "Evolving Skies", "number": "215/203", "image": "..." },
  "source": "tcgplayer",
  "variant": "holofoil",
  "prices": { "low": 76.99, "mid": 89.94, "high": 129.99, "market": 76.81, "directLow": 89.88 },
  "url": "https://prices.pokemontcg.io/tcgplayer/swsh7-215",
  "updatedAt": "2026/07/08"
}
```

Grading suffixes in `name` (e.g. "PSA 10", "Alt Art") are stripped automatically; `set` and `number` improve match accuracy. Upstream responses are cached for 5 minutes.

### `GET /api/hunt`

Auto-generated hunt list: top 30 flip-worthy cards (alt art / VMAX / VSTAR / ex / GX / Rainbow Rare) with a TCGPlayer holofoil market price between $30–$3000, sorted by price descending. Cached in memory for 6 hours. Returns `{ cards, updatedAt }`.

### `GET /api/cron/scan`

Hourly price-alert scan (scheduled by `vercel.json` crons; also triggered by the "Run Scan Now" button on the Hunt List page). A card is **hot** when its live market price ≤ Max Buy Price × 1.05. Hot cards are emailed via [Resend](https://resend.com) (`RESEND_API_KEY`, `ALERT_EMAIL` env vars) with Mercari/eBay links. Alerts are logged to the Supabase `alerts_log` table (run `supabase/alerts_log.sql`) and a card is only re-alerted when its price moves more than 5%.

> Note: Vercel cron runs hit a fresh serverless instance, so the 6-hour hunt-list cache may refetch per run — that's fine, it's one API call.

## Data model

One `cards` table drives all three pages: Inventory shows every row, Listings shows rows with `status` of `active`/`sold`, and the Scanner combines every row with live prices. See [`supabase/schema.sql`](supabase/schema.sql).
