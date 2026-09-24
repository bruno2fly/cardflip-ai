import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Zero-knowledge checkout-profile exchange, browser side.
 *
 * GET  → { pubkey, masked, pending }  - the mini's RSA public key (or null),
 *          the masked display string once consumed, and whether an encrypted
 *          profile is still waiting for the mini to pick it up.
 * POST → { ciphertext }  - the browser-encrypted profile JSON. The platform
 *          stores it as opaque ciphertext; it cannot read it. The mini
 *          decrypts with its private key on pickup and clears the row.
 */

export async function GET() {
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  const { data, error } = await supabase
    .from("bot_config")
    .select("profile_pubkey, profile_masked, profile_ciphertext, profile_updated_at")
    .eq("id", 1)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: "bot_config missing — run supabase/bot_orders.sql in the Supabase SQL Editor" },
      { status: 503 }
    );
  }
  const row = data as {
    profile_pubkey: string | null;
    profile_masked: string | null;
    profile_ciphertext: string | null;
    profile_updated_at: string | null;
  };
  return NextResponse.json({
    pubkey: row.profile_pubkey,
    masked: row.profile_masked,
    pending: !!row.profile_ciphertext,
    updatedAt: row.profile_updated_at,
  });
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  let body: { ciphertext?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext.trim() : "";
  if (!ciphertext || ciphertext.length < 100) {
    return NextResponse.json({ error: "ciphertext required (browser-encrypted)" }, { status: 400 });
  }
  const { data: cur } = await supabase
    .from("bot_config")
    .select("profile_pubkey")
    .eq("id", 1)
    .single();
  if (!(cur as { profile_pubkey?: string | null } | null)?.profile_pubkey) {
    return NextResponse.json(
      { error: "no public key yet — start the bot once so it publishes its key, then retry" },
      { status: 409 }
    );
  }
  const { error } = await supabase
    .from("bot_config")
    .update({
      profile_ciphertext: ciphertext,
      profile_updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
