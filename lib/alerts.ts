/**
 * Multi-channel restock alerts — email (Resend), SMS (Twilio), Discord webhook.
 *
 * Each channel is independently env-gated and fails soft, exactly like the
 * rest of the app (missing config → that channel is skipped, never throws,
 * never blocks the others). The stock cron does all flip-detection + dedup
 * via `stock_alerts_log` BEFORE calling here, so this module only ever
 * receives genuine out-of-stock→in-stock transitions — no double-firing.
 *
 * ToS-compliant alerting only: this notifies a human to go buy. There is no
 * cart, checkout, account, or payment logic anywhere in this file.
 */

import type { ProductStock } from "@/lib/stock";

export type Retailer = string;
export function retailerLabel(retailer: Retailer): string {
  return ({ bestbuy: "Best Buy", target: "Target" } as Record<string, string>)[retailer] ?? retailer;
}

/**
 * Stock-check cadence — documentation + budget math for the tunable interval.
 * The ACTUAL schedule lives in vercel.json ("/api/cron/stock"). Keep both in sync.
 *
 *   Current: every 2 minutes  (vercel.json "schedule": "* /2 * * * *")
 *   Budget:  ~25 products × 1 Best Buy request/run
 *            every 2 min = 720 runs/day × 25 ≈ 18,000 req/day
 *            Best Buy free tier: 50,000 req/day, ~5 req/sec → comfortable.
 *   Faster (every 1 min ≈ 36k/day) still fits; tune here AND in vercel.json.
 */
export const STOCK_CHECK_INTERVAL_MINUTES = 2;

export type StockFlip = ProductStock & { retailer: Retailer; name: string; msrp: number };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function buyUrl(f: StockFlip): string {
  return f.url ?? (f.retailer === "target" ? "https://www.target.com" : "https://www.bestbuy.com");
}

/** Channels that actually attempted a send (true) vs skipped/failed (false). */
export type AlertResult = { email: boolean; sms: boolean; discord: boolean };

// ------------------------------------------------------------------
// Email (Resend) — unchanged behavior, moved here for one alert surface
// ------------------------------------------------------------------

function stockEmailHtml(flips: StockFlip[]): string {
  const rows = flips.map(f => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;color:#111827;">${f.name}</div>
        <div style="font-size:12px;color:#6b7280;">MSRP $${fmt(f.msrp)} · ${retailerLabel(f.retailer)}${f.price ? ` · verified $${fmt(f.price)}` : ""}</div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">
        <a href="${buyUrl(f)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;">Buy at ${retailerLabel(f.retailer)} →</a>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <div style="color:#facc15;font-size:18px;font-weight:800;">🛒 CardFlip AI — Restock Alert</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:4px;">
          ${flips.length} product${flips.length === 1 ? " is" : "s are"} back IN STOCK at retail. Stock vanishes fast — buy now, flip later.
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
        Buy at MSRP only. If a listing shows a marked-up third-party seller, skip it.
      </div>
    </div>
  </body>
</html>`;
}

async function sendEmail(flips: StockFlip[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) return false;
  try {
    const retailers = Array.from(new Set(flips.map(f => retailerLabel(f.retailer)))).join(" + ");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CardFlip AI <onboarding@resend.dev>",
        to: [to],
        subject: `🛒 CardFlip Alert: ${flips.length === 1 ? flips[0].name : `${flips.length} sealed products`} back in stock at ${retailers}`,
        html: stockEmailHtml(flips),
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ------------------------------------------------------------------
// SMS (Twilio REST API)
// ------------------------------------------------------------------

/** Compact SMS body — one line per product, kept short for SMS segments. */
function smsBody(flips: StockFlip[]): string {
  if (flips.length === 1) {
    const f = flips[0];
    return `🛒 CardFlip: ${f.name} back IN STOCK at ${retailerLabel(f.retailer)}${f.price ? ` ($${fmt(f.price)})` : ""}. Buy: ${buyUrl(f)}`;
  }
  const retailers = Array.from(new Set(flips.map(f => retailerLabel(f.retailer)))).join(" + ");
  const names = flips.slice(0, 4).map(f => f.name).join(", ");
  const more = flips.length > 4 ? ` +${flips.length - 4} more` : "";
  return `🛒 CardFlip: ${flips.length} products back IN STOCK at ${retailers}: ${names}${more}. Open CardFlip to buy fast.`;
}

/**
 * Twilio SMS via their REST API (POST .../Messages.json, HTTP Basic auth).
 * Uses fetch to match this repo's pattern for every other integration
 * (Resend, Perplexity, Brave) — zero new dependencies, same graceful
 * degradation. Swappable for the twilio Node SDK if preferred.
 */
async function sendSms(flips: StockFlip[]): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.TARGET_ALERT_PHONE;
  if (!sid || !token || !from || !to) return false;
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: smsBody(flips) }).toString(),
    });
    return res.ok;
  } catch { return false; }
}

// ------------------------------------------------------------------
// Discord webhook
// ------------------------------------------------------------------

async function postDiscordWebhook(webhook: string, flips: StockFlip[]): Promise<boolean> {
  try {
    const embeds = flips.slice(0, 10).map(f => ({
      title: `${f.name} — IN STOCK at ${retailerLabel(f.retailer)}`,
      url: buyUrl(f),
      color: 0x059669,
      description: `MSRP $${fmt(f.msrp)}${f.price ? ` · verified $${fmt(f.price)}` : ""} · [Buy now →](${buyUrl(f)})`,
    }));
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "CardFlip AI",
        content: `🛒 **Restock Alert** — ${flips.length} product${flips.length === 1 ? "" : "s"} back in stock at retail. Move fast.`,
        embeds,
      }),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Fans out to every configured Discord webhook, not just one — currently
 * DISCORD_ALERT_WEBHOOK_URL (Boss/Bruno's #cardflip-ai) and
 * DISCORD_ALERT_WEBHOOK_URL_JASON (Jason's own private drop-alerts server).
 * Add more DISCORD_ALERT_WEBHOOK_URL_* env vars here as new recipients need
 * their own channel — each is independent, one failing never blocks another.
 */
async function sendDiscord(flips: StockFlip[]): Promise<boolean> {
  const webhooks = [
    process.env.DISCORD_ALERT_WEBHOOK_URL,
    process.env.DISCORD_ALERT_WEBHOOK_URL_JASON,
  ].filter((url): url is string => Boolean(url));
  if (webhooks.length === 0) return false;
  const results = await Promise.all(webhooks.map(url => postDiscordWebhook(url, flips)));
  // "attempted and at least one succeeded" — matches this module's existing
  // fail-soft convention (never throws, never blocks other channels).
  return results.some(Boolean);
}

/**
 * Fan out one restock event to every configured channel, concurrently.
 * Each channel is independent — one failing never affects the others.
 */
export async function sendStockAlerts(flips: StockFlip[]): Promise<AlertResult> {
  if (flips.length === 0) return { email: false, sms: false, discord: false };
  const [email, sms, discord] = await Promise.all([
    sendEmail(flips),
    sendSms(flips),
    sendDiscord(flips),
  ]);
  return { email, sms, discord };
}
