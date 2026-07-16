import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { supabase } from "@/lib/supabase";
import {
  Candidate, discoverFromTcgTrending, discoverFromBrave, verifyCandidate,
} from "@/lib/discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_VERIFICATIONS_PER_RUN = 12; // gentle on the keyless endpoints

/**
 * GET /api/cron/discover-products — once daily (see vercel.json).
 * Sweeps TCGPlayer's sales ranking (keyless) and Brave web search (when
 * BRAVE_SEARCH_API_KEY is set) for sealed-product candidates, verifies each
 * against real TCGPlayer data (name match + live price + live image), and
 * stores results in discovered_products. Only status='verified' rows are
 * ever shown to users — a failed check is stored as 'rejected' forever.
 */
export async function GET() {
  try {
    // --- gather candidates from every configured source (each isolated) ---
    const [trending, brave] = await Promise.allSettled([
      discoverFromTcgTrending(),
      discoverFromBrave(),
    ]);
    const candidates: Candidate[] = [
      ...(trending.status === "fulfilled" ? trending.value : []),
      ...(brave.status === "fulfilled" ? brave.value.candidates : []),
    ];
    const braveConfigured = brave.status === "fulfilled" ? brave.value.configured : false;

    // dedupe within the run (by id when present, else by name)
    const seen = new Set<string>();
    const unique = candidates.filter(c => {
      const key = c.tcgProductId ? `id:${c.tcgProductId}` : `name:${c.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (!supabase) {
      return NextResponse.json({
        braveConfigured,
        candidatesFound: unique.length,
        skipped: "Supabase not configured — discovered_products table needed to persist/verify",
        sample: unique.slice(0, 5).map(c => ({ name: c.name, source: c.source })),
      });
    }

    // --- drop anything we already know: curated array or previously processed ---
    const curatedIds = new Set(PRODUCTS.map(p => p.tcgProductId).filter(Boolean));
    const { data: existing } = await supabase
      .from("discovered_products")
      .select("candidate_name, tcg_product_id");
    const knownIds = new Set((existing ?? []).map(r => r.tcg_product_id).filter(Boolean));
    const knownNames = new Set((existing ?? []).map(r => r.candidate_name.toLowerCase()));

    const fresh = unique.filter(c => {
      if (c.tcgProductId && (curatedIds.has(c.tcgProductId) || knownIds.has(c.tcgProductId))) return false;
      if (knownNames.has(c.name.toLowerCase())) return false;
      return true;
    }).slice(0, MAX_VERIFICATIONS_PER_RUN);

    // --- verify each fresh candidate against real TCGPlayer data ---
    let verified = 0, rejected = 0;
    const verifiedSamples: { name: string; tcgProductId: number; market: number }[] = [];
    for (const c of fresh) {
      const v = await verifyCandidate(c);
      if (v && (curatedIds.has(v.tcgProductId) || knownIds.has(v.tcgProductId))) {
        // matched a product we already track under a different name — skip silently
        continue;
      }
      const row = {
        candidate_name: c.name,
        source: c.source,
        source_signal: c.signal,
        verified: Boolean(v),
        status: v ? "verified" : "rejected",
        tcg_product_id: v?.tcgProductId ?? null,
        verified_name: v?.verifiedName ?? null,
        product_type: v?.productType ?? null,
        msrp: v?.msrp ?? null,
        market_price: v?.market ?? null,
        verification_checked_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("discovered_products")
        .upsert(row, { onConflict: "tcg_product_id", ignoreDuplicates: true });
      if (!error) {
        if (v) {
          verified++;
          knownIds.add(v.tcgProductId);
          if (verifiedSamples.length < 5) {
            verifiedSamples.push({ name: v.verifiedName, tcgProductId: v.tcgProductId, market: v.market });
          }
        } else {
          rejected++;
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }

    return NextResponse.json({
      braveConfigured,
      candidatesFound: unique.length,
      newCandidatesChecked: fresh.length,
      verified,
      rejected,
      verifiedSamples,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Discovery failed: ${message}` }, { status: 502 });
  }
}
