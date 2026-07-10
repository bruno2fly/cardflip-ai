import { NextResponse } from "next/server";
import { getReleases } from "@/lib/releases";

/**
 * GET /api/releases
 * Upcoming Pokemon set releases (today → +120 days) plus sets released in
 * the last 7 days. Upstream response is cached for 6 hours.
 * Returns { upcoming: ReleaseSet[], recent: ReleaseSet[] }
 */
export async function GET() {
  try {
    const releases = await getReleases();
    return NextResponse.json(releases);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Releases lookup failed: ${message}` }, { status: 502 });
  }
}
