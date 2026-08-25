import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup  { email, password, passcode }
 *
 * Passcode-gated account creation so the admin can add users from the login
 * page instead of the Supabase dashboard — no SQL, no per-user work.
 *
 * SECURITY:
 *  - The passcode is checked HERE, on the server, against SIGNUP_PASSCODE
 *    (falls back to a baked default). It is never sent to the browser, so it
 *    can't be read out of the client bundle.
 *  - The user is created with the Supabase ADMIN (service-role) key, so you can
 *    leave "Allow new users to sign up" turned OFF in Supabase — the public
 *    anon sign-up endpoint stays closed and this passcode route is the only way
 *    in. email_confirm:true means the new account can log in immediately.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the server env (Supabase → Settings →
 * API → service_role secret). Without it, this route returns a clear 501 and
 * the login page keeps working as sign-in only.
 */

// Change the passcode any time by setting SIGNUP_PASSCODE in the env; the
// default keeps it zero-config.
const PASSCODE = process.env.SIGNUP_PASSCODE || "Skate2024!";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, password, passcode } = body as { email?: unknown; password?: unknown; passcode?: unknown };

  if (typeof email !== "string" || !email.trim() || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (typeof passcode !== "string" || passcode !== PASSCODE) {
    return NextResponse.json({ error: "Wrong passcode — you can't create accounts without it." }, { status: 403 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Account creation isn't enabled on the server yet — add SUPABASE_SERVICE_ROLE_KEY to the environment." },
      { status: 501 }
    );
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true, // no email round-trip — they can sign in right away
    });
    if (error) {
      const msg = /already been registered|already exists|duplicate/i.test(error.message)
        ? "That email already has an account — just sign in."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Could not create the account: ${message}` }, { status: 502 });
  }
}
