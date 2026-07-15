import { NextResponse } from "next/server";
import { getConfirmedReleases } from "@/lib/releases";
import { getAllIntel, IntelItem } from "@/lib/intel";

/**
 * GET /api/releases
 * Confirmed = official Pokemon TCG API sets merged with officially-announced
 * pokemon.com sets (via getConfirmedReleases — same source the alert cron
 * uses, so page and emails can't disagree). Early intel = unofficial reveals
 * (Serebii), clearly separated. Returns { upcoming, recent, intel }.
 */
export async function GET() {
  try {
    const releases = await getConfirmedReleases();

    // intel is best-effort: every source is isolated; failures yield fewer items
    let intel: IntelItem[] = [];
    try {
      intel = await getAllIntel();
    } catch { /* keep intel = [] */ }

    const confirmedNames = new Set(
      [...releases.upcoming, ...releases.recent].map(s => s.name.toLowerCase())
    );
    const earlyIntel = intel.filter(
      i => i.confidence !== "official" && !confirmedNames.has(i.setName.toLowerCase())
    );

    return NextResponse.json({ ...releases, intel: earlyIntel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Releases lookup failed: ${message}` }, { status: 502 });
  }
}
