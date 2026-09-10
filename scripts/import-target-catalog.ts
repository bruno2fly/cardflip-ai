/**
 * Import / refresh the Target catalog into the curated product list.
 *
 * What it does (idempotently):
 *   1. Loads the newest data-imports/target_catalog_<date>.json (or a file path
 *      passed as the first CLI arg).
 *   2. Matches each curated product in lib/products.ts against the catalog by
 *      name similarity (conservative — type token must agree; see
 *      matchCatalogToProducts).
 *   3. For every matched product that does NOT already have a `targetTcin`, it
 *      backfills that field in lib/products.ts so the product starts getting
 *      monitored by the existing direct-page Target checker. Products that
 *      already have a targetTcin are left untouched (idempotent).
 *
 * It NEVER rewrites anything but the targetTcin backfill, and prints a full
 * report of what it matched, applied, and skipped.
 *
 * Run:  npx tsx scripts/import-target-catalog.ts [optional/path/to/catalog.json]
 *
 * The other ~633 catalog entries that don't map to a curated product are not
 * forced into PRODUCTS — they're trackable on demand from the Target Catalog
 * page (/target-catalog), which adds them to the watchlist with the TCIN
 * pre-filled and reuses the same stock-check + alert pipeline.
 */

import fs from "node:fs";
import path from "node:path";
import { PRODUCTS } from "../lib/products";
import {
  loadTargetCatalog,
  newestCatalogFile,
  matchCatalogToProducts,
  deriveNameFromUrl,
  parsePrice,
  type TargetCatalogEntry,
} from "../lib/targetCatalog";

const PRODUCTS_FILE = path.join(process.cwd(), "lib", "products.ts");

function loadFromArgOrNewest(): { file: string | null; catalog: TargetCatalogEntry[] } {
  const arg = process.argv[2];
  if (arg) {
    const abs = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    // Normalize an explicitly-passed file with the library's public helpers
    // (mirrors lib/targetCatalog's internal normalize).
    return { file: abs, catalog: normalizeExplicit(raw) };
  }
  return { file: newestCatalogFile(), catalog: loadTargetCatalog() };
}

function normalizeExplicit(raw: unknown): TargetCatalogEntry[] {
  const rows = Array.isArray(raw) ? raw : [];
  const seen = new Set<number>();
  const out: TargetCatalogEntry[] = [];
  for (const r of rows) {
    const tcin = Number(r?.tcin);
    if (!Number.isFinite(tcin) || !r?.url || seen.has(tcin)) continue;
    seen.add(tcin);
    out.push({
      tcin,
      url: r.url,
      name: deriveNameFromUrl(r.url),
      price: parsePrice(r.price),
      stock: r.stock ?? null,
      releaseDate: r.release_date ?? null,
    });
  }
  return out;
}

function main() {
  const { file, catalog } = loadFromArgOrNewest();
  if (!file || catalog.length === 0) {
    console.error("✖ No catalog found. Drop a data-imports/target_catalog_<date>.json first.");
    process.exit(1);
  }

  console.log(`\n📡 Target catalog: ${path.basename(file)} (${catalog.length} products)\n`);

  const matches = matchCatalogToProducts(
    PRODUCTS.map(p => ({ id: p.id, name: p.name, targetTcin: p.targetTcin })),
    catalog
  );

  let source = fs.readFileSync(PRODUCTS_FILE, "utf8");
  const lines = source.split("\n");

  const applied: string[] = [];
  const alreadyPinned: string[] = [];
  const skippedConflict: string[] = [];

  for (const m of matches) {
    const product = PRODUCTS.find(p => p.id === m.productId)!;
    const scoreStr = m.score.toFixed(2);

    if (product.targetTcin != null) {
      alreadyPinned.push(`${product.name} → TCIN ${product.targetTcin} (kept; matched ${m.tcin} @ ${scoreStr})`);
      continue;
    }

    // Find the product's source line and insert targetTcin after `id: "<id>", `.
    const idToken = `id: "${m.productId}",`;
    const idx = lines.findIndex(l => l.includes(idToken));
    if (idx === -1) {
      skippedConflict.push(`${product.name} → could not locate source line for id "${m.productId}"`);
      continue;
    }
    if (lines[idx].includes("targetTcin:")) {
      alreadyPinned.push(`${product.name} → already has targetTcin in source`);
      continue;
    }
    lines[idx] = lines[idx].replace(idToken, `${idToken} targetTcin: ${m.tcin},`);
    applied.push(`${product.name} → TCIN ${m.tcin}  (${m.catalogName} @ ${scoreStr})`);
  }

  if (applied.length > 0) {
    source = lines.join("\n");
    fs.writeFileSync(PRODUCTS_FILE, source, "utf8");
  }

  const report = (title: string, rows: string[]) => {
    console.log(`${title} (${rows.length})`);
    for (const r of rows) console.log(`   • ${r}`);
    console.log("");
  };

  report("✅ Backfilled targetTcin", applied);
  report("↔️  Left as-is (already pinned)", alreadyPinned);
  if (skippedConflict.length) report("⚠️  Needs review", skippedConflict);

  console.log(
    `Done. ${applied.length} product(s) newly monitored via Target. ` +
      `${catalog.length - matches.length} catalog products remain track-on-demand at /target-catalog.\n`
  );
}

main();
