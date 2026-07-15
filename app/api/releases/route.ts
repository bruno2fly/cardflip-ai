import { NextResponse } from "next/server";
import { getReleases, ReleaseSet } from "@/lib/releases";
import { getAllIntel, IntelItem } from "@/lib/intel";

/**
 * GET /api/releases
 * Confirmed = official Pokemon TCG API sets MERGED with officially-announced
 * sets from pokemon.com (curated — pokemon.com is bot-walled from cloud IPs,
 * see lib/officialAnnouncements.ts). Early intel = unofficial reveals
 * (Serebii), clearly separated. Returns { upcoming, recent, intel }.
 */
export async function GET() {
  try {
    const releases = await getReleases();

    // intel is best-effort: every source is isolated; failures yield fewer items
    let intel: IntelItem[] = [];
    try {
      intel = await getAllIntel();
    } catch { /* keep intel = [] */ }

    const apiNames = new Set(
      [...releases.upcoming, ...releases.recent].map(s => s.name.toLowerCase())
    );

    const dayMs = 86_400_000;
    const upcoming = [...releases.upcoming];
    const recent = [...releases.recent];
    const earlyIntel: IntelItem[] = [];

    for (const item of intel) {
      if (apiNames.has(item.setName.toLowerCase())) continue; // API already lists it

      // Official announcements (pokemon.com) go straight into Confirmed
      if (item.confidence === "official" && item.releaseDateIso) {
        const diffDays = Math.ceil((new Date(item.releaseDateIso).getTime() - Date.now()) / dayMs);
        const entry: ReleaseSet = {
          id: `official-${item.setName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: item.setName,
          series: "Officially Announced",
          releaseDate: item.releaseDateIso.replace(/-/g, "/"),
          logoUrl: null,
          symbolUrl: null,
          announcedVia: "pokemon.com",
        };
        if (diffDays >= 0 && diffDays <= 120) {
          upcoming.push({ ...entry, daysUntil: diffDays });
        } else if (diffDays < 0 && diffDays >= -7) {
          recent.push({ ...entry, daysAgo: Math.abs(diffDays) });
        }
        continue;
      }

      // Everything else (Serebii etc.) stays clearly-labeled Early Intel
      earlyIntel.push(item);
    }

    upcoming.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));
    recent.sort((a, b) => (a.daysAgo ?? 0) - (b.daysAgo ?? 0));

    return NextResponse.json({ upcoming, recent, intel: earlyIntel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Releases lookup failed: ${message}` }, { status: 502 });
  }
}
