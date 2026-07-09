import { NextResponse } from "next/server";
import { getHuntList, getLiveMarkets, HuntCard } from "@/lib/hunt";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const MAX_BUY_RATIO = 0.70;   // Max Buy Price = hunt-list market × 0.70
const HOT_TOLERANCE = 1.05;   // hot when live market ≤ Max Buy × 1.05
const DEDUP_THRESHOLD = 0.05; // re-alert only if price moved > 5% since last alert

type HotCard = HuntCard & { liveMarket: number; maxBuy: number };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function mercariUrl(name: string) {
  return `https://www.mercari.com/search/?keyword=${encodeURIComponent(`${name} pokemon`)}&sortBy=3`;
}
function ebayUrl(name: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${name} pokemon`)}&LH_BIN=1&_sop=15`;
}

function buildEmailHtml(hot: HotCard[]): string {
  const rows = hot.map(c => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;color:#111827;">${c.name}</div>
        <div style="font-size:12px;color:#6b7280;">${c.set} · #${c.number}</div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;">
        <span style="font-weight:700;color:#059669;">$${fmt(c.maxBuy)}</span>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">
        $${fmt(c.liveMarket)}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;">
        <a href="${mercariUrl(c.name)}" style="display:inline-block;background:#ec4899;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;margin-right:6px;">Mercari</a>
        <a href="${ebayUrl(c.name)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;">eBay</a>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <div style="color:#facc15;font-size:18px;font-weight:800;">🃏 CardFlip AI</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:4px;">
          ${hot.length} card${hot.length === 1 ? " is" : "s are"} at or near your Max Buy Price right now. Move fast — these windows close quickly.
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Card</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Max Buy</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Market Now</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Find It</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
        Buy at or below the <strong style="color:#059669;">Max Buy</strong> price to lock in profit after 13% fees.
        Prices are live TCGPlayer market values and change constantly.
      </div>
    </div>
  </body>
</html>`;
}

async function sendAlertEmail(hot: HotCard[]): Promise<{ ok: boolean; detail: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) return { ok: false, detail: "RESEND_API_KEY / ALERT_EMAIL not configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CardFlip AI <onboarding@resend.dev>",
      to: [to],
      subject: `🔥 CardFlip AI — ${hot.length} Buy Opportunit${hot.length === 1 ? "y" : "ies"} Right Now`,
      html: buildEmailHtml(hot),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, detail: `Resend responded ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true, detail: "sent" };
}

/**
 * GET /api/cron/scan — hourly Vercel cron (see vercel.json) + manual trigger.
 * Hot = live TCG market ≤ (Max Buy Price × 1.05). Dedup: skip cards whose
 * price moved ≤5% since the last alert stored in Supabase `alerts_log`.
 */
export async function GET() {
  try {
    const { cards } = await getHuntList();
    const live = await getLiveMarkets(cards.map(c => c.id));

    const hot: HotCard[] = [];
    for (const c of cards) {
      const liveMarket = live.get(c.id);
      if (liveMarket == null) continue;
      const maxBuy = c.market * MAX_BUY_RATIO;
      if (liveMarket <= maxBuy * HOT_TOLERANCE) hot.push({ ...c, liveMarket, maxBuy });
    }

    // Dedup against alerts_log: only re-alert if price changed > 5%
    let toAlert = hot;
    let skippedDuplicates = 0;
    if (supabase && hot.length > 0) {
      const { data } = await supabase
        .from("alerts_log")
        .select("card_id, alerted_price, created_at")
        .in("card_id", hot.map(h => h.id))
        .order("created_at", { ascending: false });
      const lastPrice = new Map<string, number>();
      for (const row of data ?? []) {
        if (!lastPrice.has(row.card_id)) lastPrice.set(row.card_id, Number(row.alerted_price));
      }
      toAlert = hot.filter(h => {
        const prev = lastPrice.get(h.id);
        return prev == null || Math.abs(h.liveMarket - prev) / prev > DEDUP_THRESHOLD;
      });
      skippedDuplicates = hot.length - toAlert.length;
    }

    let emailed = false;
    let emailDetail = "no hot cards";
    if (toAlert.length > 0) {
      const result = await sendAlertEmail(toAlert);
      emailed = result.ok;
      emailDetail = result.detail;

      // log alerts only after a successful send so failures retry next hour
      if (emailed && supabase) {
        await supabase.from("alerts_log").insert(
          toAlert.map(h => ({
            card_id: h.id,
            card_name: h.name,
            alerted_price: h.liveMarket,
            max_buy: h.maxBuy,
          }))
        );
      }
    }

    return NextResponse.json({
      scannedAt: new Date().toISOString(),
      scanned: cards.length,
      hot: hot.length,
      skippedDuplicates,
      alerted: emailed ? toAlert.length : 0,
      emailed,
      emailDetail,
      hotCards: hot.map(h => ({ name: h.name, maxBuy: h.maxBuy, liveMarket: h.liveMarket })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Scan failed: ${message}` }, { status: 502 });
  }
}
