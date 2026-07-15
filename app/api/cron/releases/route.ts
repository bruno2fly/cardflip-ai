import { NextResponse } from "next/server";
import { getConfirmedReleases, ReleaseSet } from "@/lib/releases";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function releaseEmailHtml(set: ReleaseSet): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;padding:20px 24px;">
        <div style="color:#facc15;font-size:18px;font-weight:800;">🎴 CardFlip AI — Release Alert</div>
      </div>
      <div style="padding:24px;">
        <div style="font-size:20px;font-weight:800;color:#111827;">${set.name}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">${set.series} series</div>
        <div style="margin-top:16px;font-size:14px;color:#111827;">
          Releases <strong>${set.releaseDate}</strong> — that's <strong style="color:#dc2626;">${set.daysUntil} day${set.daysUntil === 1 ? "" : "s"}</strong> away.
        </div>
        <div style="margin-top:16px;background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:12px 16px;font-size:13px;color:#713f12;">
          Pre-order now at Pokemon Center before retail sells out. Early buyers flip for 2–3× after the print run ends.
        </div>
      </div>
    </div>
  </body>
</html>`;
}

async function sendReleaseEmail(set: ReleaseSet): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "CardFlip AI <onboarding@resend.dev>",
      to: [to],
      subject: `🎴 CardFlip Alert: ${set.name} releases in ${set.daysUntil} days`,
      html: releaseEmailHtml(set),
    }),
  });
  return res.ok;
}

/**
 * GET /api/cron/releases — daily Vercel cron (9am EST, see vercel.json).
 * Emails an alert for any set releasing within 7 days. Each set is alerted
 * exactly once, tracked in the Supabase `release_alerts_log` table.
 */
export async function GET() {
  try {
    // merged view: official API + curated pokemon.com announcements — the
    // same list the /releases page shows, so the 7-day alerts match it
    const { upcoming } = await getConfirmedReleases();
    const imminent = upcoming.filter(s => (s.daysUntil ?? 999) <= 7);

    if (imminent.length === 0) {
      return NextResponse.json({ checked: upcoming.length, imminent: 0, alerted: 0 });
    }

    if (!supabase) {
      // without the log table we can't dedup — skip rather than spam daily
      return NextResponse.json({
        checked: upcoming.length,
        imminent: imminent.length,
        alerted: 0,
        skipped: "Supabase not configured — release_alerts_log needed to avoid duplicate alerts",
      });
    }

    // only alert once per set, ever
    const { data: logged } = await supabase
      .from("release_alerts_log")
      .select("set_id")
      .in("set_id", imminent.map(s => s.id));
    const alreadyAlerted = new Set((logged ?? []).map(r => r.set_id));
    const toAlert = imminent.filter(s => !alreadyAlerted.has(s.id));

    let alerted = 0;
    for (const set of toAlert) {
      const sent = await sendReleaseEmail(set);
      if (sent) {
        alerted++;
        await supabase.from("release_alerts_log").insert({
          set_id: set.id,
          set_name: set.name,
          release_date: set.releaseDate.replace(/\//g, "-"),
        });
      }
    }

    return NextResponse.json({
      checked: upcoming.length,
      imminent: imminent.length,
      skippedAlreadyAlerted: imminent.length - toAlert.length,
      alerted,
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Release scan failed: ${message}` }, { status: 502 });
  }
}
