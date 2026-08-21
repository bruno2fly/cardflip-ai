import { NextResponse } from "next/server";
import { upcomingWindows } from "@/lib/dropPatterns";
import { fetchTypaCommunityUpdates } from "@/lib/dropIntel";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const [patternsResult, signalsResult] = await Promise.allSettled([
    Promise.resolve().then(() => upcomingWindows(now)),
    fetchTypaCommunityUpdates(),
  ]);

  return NextResponse.json({
    patterns: patternsResult.status === "fulfilled" ? patternsResult.value : [],
    liveSignals: signalsResult.status === "fulfilled" ? signalsResult.value : [],
    generatedAt: now.toISOString(),
  });
}
