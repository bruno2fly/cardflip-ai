"use client";
import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import Sidebar from "@/components/Sidebar";
import { Loader2, LogIn } from "lucide-react";

/**
 * Auth gate for the whole app.
 *
 * The app is a per-user workspace now: personal data (inventory, sealed
 * inventory, listings, checkout profile) is scoped to the signed-in user by
 * Supabase RLS. So we mount the real UI (Sidebar + pages) ONLY when signed in;
 * otherwise we show a login screen. Accounts are invite-only — created by the
 * admin in the Supabase dashboard — so there is no public sign-up form.
 *
 * If Supabase isn't configured at all (no env vars), we fail OPEN and render
 * the app without auth, matching the rest of the codebase's graceful
 * degradation — the gate only engages once Supabase exists.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "in" | "out">("checking");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) { setStatus("in"); return; } // unconfigured → no gate
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setStatus(data.session ? "in" : "out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "in" : "out");
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (status === "out") return <LoginScreen />;

  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={user?.email ?? null} onSignOut={signOut} />
      <main className="flex-1 min-w-0 overflow-x-hidden p-4 pt-16 md:ml-64 md:p-6">{children}</main>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message || "Sign-in failed. Check your email and password.");
      setBusy(false);
    }
    // on success, onAuthStateChange in AppShell swaps to the app — no navigation needed
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-lg font-bold text-gray-900">🃏</div>
          <div>
            <div className="font-bold text-white text-base leading-tight">CardFlip AI</div>
            <div className="text-xs text-gray-500">Trading Intelligence</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <h1 className="text-white font-semibold text-lg">Sign in</h1>

          <div className="space-y-1">
            <label className="text-gray-400 text-xs font-medium">Email</label>
            <input
              type="email" autoComplete="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label className="text-gray-400 text-xs font-medium">Password</label>
            <input
              type="password" autoComplete="current-password" required value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400/50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-800/50 text-red-300 text-xs rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit" disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />} Sign in
          </button>

          <p className="text-gray-600 text-[11px] leading-relaxed text-center pt-1">
            Accounts are invite-only — created by the admin. Need access? Ask the admin to add you in Supabase.
          </p>
        </form>
      </div>
    </div>
  );
}
