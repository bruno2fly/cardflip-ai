import { NextResponse } from "next/server";
import { getLeakIntel, LeakIntel } from "@/lib/leakIntel";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function leakEmailHtml(items: LeakIntel[]): string {
  const rows = items.map(i => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:700;color:#111827;font-size:15px;">${i.setName}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">
          ${i.releaseDate ? `Releases ${i.releaseDate}` : "Release date not announced yet"}${i.detail ? ` · ${i.detail}` : ""}
        </div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:center;">
        <a href="${i.sourceUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;padding:6px 12px;border-radius:6px;">Serebii →</a>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <div style="color:#facc15;font-size:18px;font-weight:800;">🔮 CardFlip AI — Early Set Intel</div>
        <div style="color:#9ca3af;font-size:13px;margin-top:4px;">
          ${items.length} new set reveal${items.length === 1 ? "" : "s"} spotted on Serebii — weeks before the official API lists ${items.length === 1 ? "it" : "them"}.
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
        Unofficial intel, not yet in the official Pokemon TCG database. Early movers pre-order sealed product before hype pricing kicks in.
      </div>
    </div>
  </body>
</html>`;
}

async function sendLeakEmail(items: LeakIntel[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CardFlip AI <onboarding@resend.dev>",
      to: [to],
      subject: `🔮 CardFlip Intel: ${items.length === 1 ? `"${items[0].setName}" set revealed` : `${items.length} new sets revealed`} — get ahead of it`,
      html: leakEmailHtml(items),
    }),
  });
  return res.ok;
}

/**
 * GET /api/cron/leak-scan — every 6 hours (see vercel.json).
 * Scrapes Serebii for set reveals; emails Jason the moment a NEW one shows
 * up. Dedup via Supabase `leak_intel_log` (unique per normalized set name)
 * so each reveal alerts exactly once, ever.
 */
export async function GET() {
  try {
    const intel = await getLeakIntel(true);

    if (intel.length === 0) {
      return NextResponse.json({ found: 0, newReveals: 0, emailed: false });
    }
    if (!supabase) {
      return NextResponse.json({
        found: intel.length,
        skipped: "Supabase not configured — leak_intel_log needed to avoid duplicate alerts",
      });
    }

    const { data: logged } = await supabase
      .from("leak_intel_log")
      .select("set_name")
      .in("set_name", intel.map(i => i.setName.toLowerCase()));
    const known = new Set((logged ?? []).map(r => r.set_name));
    const fresh = intel.filter(i => !known.has(i.setName.toLowerCase()));

    let emailed = false;
    if (fresh.length > 0) {
      emailed = await sendLeakEmail(fresh);
      // log regardless of email success? No — log only after send so a
      // Resend outage retries in 6h instead of losing the alert forever.
      if (emailed) {
        await supabase.from("leak_intel_log").insert(
          fresh.map(i => ({
            set_name: i.setName.toLowerCase(),
            display_name: i.setName,
            release_date: i.releaseDate,
            source: i.source,
            source_url: i.sourceUrl,
          }))
        );
      }
    }

    return NextResponse.json({
      found: intel.length,
      newReveals: fresh.length,
      emailed,
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Leak scan failed: ${message}` }, { status: 502 });
  }
}
