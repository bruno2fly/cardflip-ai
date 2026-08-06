import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { getBestBuyStock } from "@/lib/stock";
import { productUrl, parseTargetHtml } from "@/lib/targetStock";
import { getSealedPricingCacheStatus } from "@/lib/sealedPricing";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/status — REAL live health of every integration.
 *
 * Ground rules (see the /status page): no fake green. Where a live probe is
 * cheap and side-effect-free we run it for real (Best Buy test call, Target
 * page fetch, source reachability, a Supabase count). Where a live test would
 * cost money or quota — sending an email/SMS, or spending a tcgapi.dev refresh
 * — we do a CONFIG check only and say so explicitly. Anything unverifiable is
 * reported honestly, never assumed "probably fine".
 *
 * Every check is isolated (Promise.allSettled + per-check try/catch) so one
 * slow/broken integration can't take the page down.
 */

type Dot = "green" | "yellow" | "red" | "gray"; // 🟢 working · 🟡 degraded/partial · 🔴 broken/unset · ⚪ not implemented
type Row = { name: string; status: Dot; detail: string };
type Section = { title: string; rows: Row[] };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CardFlipAI/1.0 (status-check)";

function envSet(name: string): boolean {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

/** Lightweight reachability probe. Never throws. */
async function probe(url: string, timeoutMs = 6000): Promise<{ ok: boolean; status: number; bytes: number; blocked: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { "User-Agent": UA } });
    const body = await res.text();
    const blocked = body.length < 2000 || /Incapsula|Pardon Our Interruption|Access Denied|Bot Manager|are you a human|hcaptcha|recaptcha/i.test(body);
    return { ok: res.ok, status: res.status, bytes: body.length, blocked };
  } catch (err) {
    return { ok: false, status: 0, bytes: 0, blocked: false, error: err instanceof Error ? err.message : "error" };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Stock Monitoring -------------------------------------------------------

async function checkBestBuy(): Promise<Row> {
  if (!envSet("BESTBUY_API_KEY")) {
    return { name: "Best Buy API", status: "red", detail: "BESTBUY_API_KEY not set — stock checks return \"unknown\" for every product" };
  }
  try {
    const probeProduct = PRODUCTS.find(p => p.id === "prismatic-etb") ?? PRODUCTS[0];
    const res = await getBestBuyStock([{ id: probeProduct.id, name: probeProduct.name }], true);
    if (!res.configured) return { name: "Best Buy API", status: "red", detail: "BESTBUY_API_KEY present but the client reports not-configured" };
    const s = res.statuses[0];
    return { name: "Best Buy API", status: "green", detail: `Live test call succeeded — "${probeProduct.name}" → ${s?.status ?? "unknown"}` };
  } catch (err) {
    return { name: "Best Buy API", status: "red", detail: `Test call failed: ${err instanceof Error ? err.message : "error"}` };
  }
}

async function checkTarget(): Promise<Row> {
  const pinned = PRODUCTS.find(p => p.targetTcin);
  if (!pinned?.targetTcin) return { name: "Target scraping", status: "gray", detail: "No pinned Target TCIN to probe" };
  const r = await probe(productUrl(pinned.targetTcin), 8000);
  if (!r.ok && r.status === 0) return { name: "Target scraping", status: "red", detail: `Fetch failed (${r.error ?? "network"}) for TCIN ${pinned.targetTcin}` };
  // reuse targetStock's own detection on the fetched HTML
  try {
    const res = await fetch(productUrl(pinned.targetTcin), { cache: "no-store", headers: { "User-Agent": UA } });
    const html = await res.text();
    const state = parseTargetHtml(html);
    if (state === "blocked") return { name: "Target scraping", status: "red", detail: `Bot-walled — TCIN ${pinned.targetTcin} returned a challenge page (${html.length} bytes)` };
    return { name: "Target scraping", status: "green", detail: `Live page fetched (${html.length.toLocaleString()} bytes) — TCIN ${pinned.targetTcin} → ${state}` };
  } catch (err) {
    return { name: "Target scraping", status: "red", detail: `Fetch failed: ${err instanceof Error ? err.message : "error"}` };
  }
}

// ---- Alerts (config checks only — never fires a real send) -------------------

function checkEmail(): Row {
  const key = envSet("RESEND_API_KEY"), to = envSet("ALERT_EMAIL");
  if (key && to) return { name: "Email (Resend)", status: "green", detail: "Config check only (no test send): RESEND_API_KEY + ALERT_EMAIL set" };
  const missing = [!key && "RESEND_API_KEY", !to && "ALERT_EMAIL"].filter(Boolean).join(", ");
  return { name: "Email (Resend)", status: "red", detail: `Not configured — missing ${missing}` };
}

function checkDiscord(): Row {
  return envSet("DISCORD_ALERT_WEBHOOK_URL")
    ? { name: "Discord webhook", status: "green", detail: "Config check only (no test post): DISCORD_ALERT_WEBHOOK_URL set" }
    : { name: "Discord webhook", status: "red", detail: "Not configured — DISCORD_ALERT_WEBHOOK_URL missing" };
}

function checkSms(): Row {
  const need = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TARGET_ALERT_PHONE"];
  const missing = need.filter(n => !envSet(n));
  if (missing.length === 0) return { name: "SMS (Twilio)", status: "green", detail: "Config check only (no test send): all 4 Twilio vars set" };
  if (missing.length === need.length) return { name: "SMS (Twilio)", status: "red", detail: `Not configured — missing ${missing.join(", ")}` };
  return { name: "SMS (Twilio)", status: "yellow", detail: `Partially configured — missing ${missing.join(", ")}` };
}

// ---- Pricing & Intel --------------------------------------------------------

function checkSealedPricing(): Row {
  const s = getSealedPricingCacheStatus();
  if (!s.configured) return { name: "Sealed pricing (tcgapi.dev)", status: "red", detail: "TCGAPI_DEV_KEY not set — market prices fall back to manual entry" };
  if (s.cached && s.dailyRemaining != null) {
    return { name: "Sealed pricing (tcgapi.dev)", status: "green", detail: `Key set · ${s.dailyRemaining} of daily quota remaining (cached ${s.checkedAt ? new Date(s.checkedAt).toISOString().slice(11, 16) + "Z" : "?"}) · ${s.refreshesToday}/${s.maxRefreshesPerDay} refreshes today` };
  }
  return { name: "Sealed pricing (tcgapi.dev)", status: "green", detail: "Key set · no cached quota reading in this instance (not fetched to avoid spending a refresh)" };
}

async function checkPriceTrend(): Promise<Row> {
  if (!supabase) return { name: "Price trend history", status: "red", detail: "Supabase not configured — no price_history to read" };
  try {
    const { data, error } = await supabase.from("price_history").select("product_id");
    if (error) return { name: "Price trend history", status: "yellow", detail: `Could not read price_history: ${error.message}` };
    const rows = data ?? [];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.product_id, (counts.get(r.product_id) ?? 0) + 1);
    const sufficient = Array.from(counts.values()).filter(c => c >= 3).length;
    const totalProducts = PRODUCTS.length;
    if (rows.length === 0) return { name: "Price trend history", status: "yellow", detail: "Table exists but empty — trends show \"tracking\" until 3+ points/product accrue" };
    const dot: Dot = sufficient === 0 ? "yellow" : "green";
    return { name: "Price trend history", status: dot, detail: `${rows.length} rows · ${sufficient} of ${counts.size} tracked products have ≥3 points (real trends) · ${totalProducts} products total` };
  } catch (err) {
    return { name: "Price trend history", status: "yellow", detail: `Query failed: ${err instanceof Error ? err.message : "error"}` };
  }
}

function checkPerplexity(): Row {
  return envSet("PERPLEXITY_API_KEY")
    ? { name: "Decision engine (Perplexity Sonar)", status: "green", detail: "PERPLEXITY_API_KEY set — BUY/WAIT/AVOID verdicts enabled" }
    : { name: "Decision engine (Perplexity Sonar)", status: "red", detail: "PERPLEXITY_API_KEY not set — decision engine is inert" };
}

async function checkIntelSource(name: string, url: string, opts: { curated?: boolean } = {}): Promise<Row> {
  const r = await probe(url, 7000);
  if (r.error) return { name, status: "red", detail: `Unreachable: ${r.error}` };
  if (r.blocked || !r.ok) {
    // pokemon.com is expected-blocked and served from a curated fallback list
    return opts.curated
      ? { name, status: "yellow", detail: `Bot-walled (HTTP ${r.status}, ${r.bytes} bytes) — as expected; served from curated list instead` }
      : { name, status: "red", detail: `Blocked/unreachable (HTTP ${r.status}, ${r.bytes} bytes)` };
  }
  return { name, status: "green", detail: `Reachable — HTTP ${r.status}, ${r.bytes.toLocaleString()} bytes` };
}

// ---- Cron Jobs --------------------------------------------------------------

// Mirror of vercel.json, plus the Supabase table whose newest timestamp is the
// best available "did this actually run" proxy (null where none exists).
const CRONS: { path: string; schedule: string; scheduleHuman: string; table?: string; column?: string }[] = [
  { path: "/api/cron/scan", schedule: "0 * * * *", scheduleHuman: "hourly", table: "alerts_log", column: "created_at" },
  { path: "/api/cron/stock", schedule: "*/2 * * * *", scheduleHuman: "every 2 min", table: "stock_alerts_log", column: "created_at" },
  { path: "/api/cron/releases", schedule: "0 14 * * *", scheduleHuman: "daily 14:00 UTC", table: "release_alerts_log", column: "alerted_at" },
  { path: "/api/cron/discover-products", schedule: "30 13 * * *", scheduleHuman: "daily 13:30 UTC", table: "discovered_products", column: "discovered_at" },
  { path: "/api/cron/compute-verdicts", schedule: "45 13 * * *", scheduleHuman: "daily 13:45 UTC", table: "product_verdicts", column: "computed_at" },
  { path: "/api/cron/leak-scan", schedule: "0 */6 * * *", scheduleHuman: "every 6h", table: "leak_intel_log", column: "found_at" },
];

async function checkCrons(): Promise<Row[]> {
  return Promise.all(CRONS.map(async c => {
    const name = `${c.path} · ${c.scheduleHuman}`;
    if (!supabase || !c.table || !c.column) {
      return { name, status: "gray" as Dot, detail: `Scheduled ${c.schedule} — no last-run marker logged` };
    }
    try {
      const { data, error } = await supabase.from(c.table).select(c.column).order(c.column, { ascending: false }).limit(1);
      if (error) return { name, status: "yellow" as Dot, detail: `Scheduled ${c.schedule} — couldn't read ${c.table}: ${error.message}` };
      const first = (data?.[0] ?? undefined) as unknown as Record<string, unknown> | undefined;
      const ts = typeof first?.[c.column] === "string" ? (first[c.column] as string) : undefined;
      if (!ts) return { name, status: "yellow" as Dot, detail: `Scheduled ${c.schedule} — ${c.table} has no rows yet` };
      const ageH = (Date.now() - new Date(ts).getTime()) / 3_600_000;
      // "recent enough" heuristic keyed loosely to each cadence
      const staleAfterH = c.schedule.includes("*/2") ? 1 : c.scheduleHuman === "hourly" ? 3 : 30;
      const dot: Dot = ageH <= staleAfterH ? "green" : "yellow";
      return { name, status: dot, detail: `Last ${c.column} in ${c.table}: ${new Date(ts).toISOString().replace("T", " ").slice(0, 16)}Z (${ageH < 1 ? `${Math.round(ageH * 60)}m` : `${ageH.toFixed(1)}h`} ago)` };
    } catch (err) {
      return { name, status: "yellow" as Dot, detail: `Scheduled ${c.schedule} — proxy read failed: ${err instanceof Error ? err.message : "error"}` };
    }
  }));
}

// ---- Database ---------------------------------------------------------------

async function checkSupabase(): Promise<Row> {
  const url = envSet("NEXT_PUBLIC_SUPABASE_URL"), key = envSet("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean).join(", ");
    return { name: "Supabase connection", status: "red", detail: `Not configured — missing ${missing}` };
  }
  if (!supabase) return { name: "Supabase connection", status: "red", detail: "Client failed to initialise despite env vars" };
  try {
    const { count, error } = await supabase.from("price_history").select("*", { count: "exact", head: true });
    if (error) return { name: "Supabase connection", status: "red", detail: `Live query failed: ${error.message}` };
    return { name: "Supabase connection", status: "green", detail: `Live count query succeeded — price_history has ${count ?? 0} rows` };
  } catch (err) {
    return { name: "Supabase connection", status: "red", detail: `Live query threw: ${err instanceof Error ? err.message : "error"}` };
  }
}

export async function GET() {
  const [bestbuy, target, priceTrend, priceSource, sup, crons] = await Promise.all([
    checkBestBuy().catch((e): Row => ({ name: "Best Buy API", status: "red", detail: `check crashed: ${e}` })),
    checkTarget().catch((e): Row => ({ name: "Target scraping", status: "red", detail: `check crashed: ${e}` })),
    checkPriceTrend().catch((e): Row => ({ name: "Price trend history", status: "yellow", detail: `check crashed: ${e}` })),
    checkSealedPricing(),
    checkSupabase().catch((e): Row => ({ name: "Supabase connection", status: "red", detail: `check crashed: ${e}` })),
    checkCrons().catch((): Row[] => []),
  ]);

  const [serebii, pokemonCom, pokeleaks] = await Promise.all([
    checkIntelSource("Serebii", "https://www.serebii.net/index2.shtml").catch((): Row => ({ name: "Serebii", status: "red", detail: "check crashed" })),
    checkIntelSource("pokemon.com (curated)", "https://tcg.pokemon.com/en-us/expansions/", { curated: true }).catch((): Row => ({ name: "pokemon.com (curated)", status: "yellow", detail: "check crashed" })),
    checkIntelSource("r/PokeLeaks", "https://www.reddit.com/r/PokeLeaks/.rss").catch((): Row => ({ name: "r/PokeLeaks", status: "red", detail: "check crashed" })),
  ]);

  const sections: Section[] = [
    { title: "Stock Monitoring", rows: [
      bestbuy,
      target,
      { name: "Walmart", status: "gray", detail: "Not implemented — no Walmart stock integration exists yet" },
      { name: "Pokémon Center", status: "gray", detail: "Not implemented — no Pokémon Center stock integration exists yet" },
    ] },
    { title: "Alerts", rows: [checkEmail(), checkDiscord(), checkSms()] },
    { title: "Pricing & Intel", rows: [priceSource, priceTrend, checkPerplexity(), serebii, pokemonCom, pokeleaks] },
    { title: "Cron Jobs", rows: crons },
    { title: "Database", rows: [sup] },
  ];

  return NextResponse.json({ generatedAt: new Date().toISOString(), sections });
}
