import { NextResponse } from "next/server";

// TEMPORARY test-only endpoint — sends one real test email via Resend
// to confirm ALERT_EMAIL is wired correctly. Remove after use.
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!apiKey || !to) {
    return NextResponse.json({ ok: false, error: "RESEND_API_KEY or ALERT_EMAIL missing", to }, { status: 500 });
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CardFlip AI <onboarding@resend.dev>",
        to: [to],
        subject: "🧪 CardFlip AI — Test Alert",
        html: `<div style="font-family:sans-serif;padding:20px;">
          <h2>🛒 CardFlip AI Test Alert</h2>
          <p>This is a test of the restock alert email system.</p>
          <p>If you're reading this, alerts are correctly configured to send to: <b>${to}</b></p>
        </div>`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, status: res.status, to, body });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
