# Target catalog imports

This folder holds scraped snapshots of Target's Pokémon TCG catalog, one JSON
file per pull, named `target_catalog_YYYY-MM-DD.json`.

Each entry looks like:

```json
{
  "tcin": "1010892076",
  "url": "https://www.target.com/p/.../-/A-1010892076",
  "price": "$69.99",
  "stock": "In Stock",
  "release_date": null
}
```

The app always uses the **newest** file (by filename date), so a refresh is just
"drop a new file + run the importer".

## How the catalog is used

- **Runtime:** `lib/targetCatalog.ts` loads the newest file, derives a product
  name from each URL slug, and serves it to the browser via
  `GET /api/target-catalog`. The **Target Catalog** page (`/target-catalog`) lets
  you search all products and 1-click **Track** any of them — tracking adds it to
  your watchlist with the TCIN pre-filled, so the existing stock cron monitors it
  and alerts through the same channels.
- **Curated backfill:** `scripts/import-target-catalog.ts` matches the catalog
  against the curated `lib/products.ts` list and backfills `targetTcin` on any
  matched product that doesn't have one yet (so it starts being monitored). It is
  idempotent — re-running never double-writes.

## Refreshing the catalog

1. Produce a new scrape (Comet/Perplexity over Target's Pokémon TCG category) and
   save it here as `target_catalog_<today>.json` in the same shape as above.
2. Backfill curated matches:

   ```bash
   npm run import:target-catalog
   # or an explicit file:
   npx tsx scripts/import-target-catalog.ts data-imports/target_catalog_2026-10-01.json
   ```

3. Commit the new JSON file and any `lib/products.ts` changes the script made.
   The runtime picks up the newest file automatically — no code change needed.

Old snapshots can be kept for history or deleted; only the newest is read.
