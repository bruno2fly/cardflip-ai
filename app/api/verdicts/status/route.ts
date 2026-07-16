import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/verdicts/status — cheap local check, no API call.
 * Lets pages show an honest "decision engine not enabled yet" vs.
 * "enabled, just not computed for this product yet" message, without
 * spending a Perplexity call just to ask if the key exists.
 */
export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.PERPLEXITY_API_KEY) });
}
