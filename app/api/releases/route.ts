import { NextResponse } from "next/server";
import { getReleases } from "@/lib/releases";
import { getLeakIntel, LeakIntel } from "@/lib/leakIntel";

/**
 * GET /api/releases
 * Confirmed: upcoming sets (today → +120 days) + last-7-days from the
 * official Pokemon TCG API (slow mirror, cached 6 hours).
 * Early intel: unofficial set reveals scraped from Serebii news (cached
 * 30 min) — often weeks ahead of the official API. Clearly separated so
 * the UI can label confirmed vs unofficial.
 * Returns { upcoming, recent, intel }.
 */
export async function GET() {
  try {
    const releases = await getReleases();

    // intel is best-effort: a Serebii failure yields [] and never breaks this route
    let intel: LeakIntel[] = [];
    try {
      intel = await getLeakIntel();
      // drop intel that the official API already lists — it's confirmed now
      const confirmed = new Set(
        [...releases.upcoming, ...releases.recent].map(s => s.name.toLowerCase())
      );
      intel = intel.filter(i => !confirmed.has(i.setName.toLowerCase()));
    } catch { /* keep intel = [] */ }

    return NextResponse.json({ ...releases, intel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Releases lookup failed: ${message}` }, { status: 502 });
  }
}
