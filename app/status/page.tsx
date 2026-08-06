"use client";
import { useState, useEffect, useCallback } from "react";
import { Activity, RefreshCw, Loader2 } from "lucide-react";

type Dot = "green" | "yellow" | "red" | "gray";
type Row = { name: string; status: Dot; detail: string };
type Section = { title: string; rows: Row[] };
type StatusResp = { generatedAt: string; sections: Section[] };

const DOT: Record<Dot, { emoji: string; cls: string; label: string }> = {
  green: { emoji: "🟢", cls: "text-green-400", label: "working" },
  yellow: { emoji: "🟡", cls: "text-yellow-400", label: "degraded / partial" },
  red: { emoji: "🔴", cls: "text-red-400", label: "broken / not configured" },
  gray: { emoji: "⚪", cls: "text-gray-500", label: "not implemented" },
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: StatusResp };

export default function StatusPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setState({ status: "ok", data });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Failed to load status" });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const tally = state.status === "ok"
    ? state.data.sections.flatMap(s => s.rows).reduce((a, r) => { a[r.status]++; return a; }, { green: 0, yellow: 0, red: 0, gray: 0 } as Record<Dot, number>)
    : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={22} className="text-yellow-400" /> System Status
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Real live health of every integration — checked right now, not assumed. No test emails/SMS are sent and no
            pricing quota is spent by loading this page.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 border border-gray-700 text-gray-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-check
        </button>
      </div>

      {tally && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          {(["green", "yellow", "red", "gray"] as Dot[]).map(d => (
            <span key={d} className={`flex items-center gap-1.5 ${DOT[d].cls}`}>
              {DOT[d].emoji} {tally[d]} {DOT[d].label}
            </span>
          ))}
          {state.status === "ok" && (
            <span className="text-gray-600 ml-auto">
              checked {new Date(state.data.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {state.status === "loading" && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Running live health checks…
        </div>
      )}

      {state.status === "error" && (
        <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          Couldn&apos;t run status checks: {state.message}
        </div>
      )}

      {state.status === "ok" && state.data.sections.map(section => (
        <div key={section.title} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">{section.title}</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800/70">
            {section.rows.map((row, i) => (
              <div key={`${row.name}-${i}`} className="flex items-start gap-3 px-4 py-3">
                <span className="text-base leading-6 flex-shrink-0" title={DOT[row.status].label}>{DOT[row.status].emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium">{row.name}</div>
                  <div className={`text-xs mt-0.5 ${row.status === "green" ? "text-gray-400" : DOT[row.status].cls}`}>{row.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-gray-600 text-[11px] leading-relaxed">
        Alerts (Resend / Discord / Twilio) are <strong>config checks only</strong> — this page never fires a real
        send. Cron rows show the newest timestamp in each job&apos;s Supabase table as a proxy for &quot;did it actually
        run&quot;. Anything that can&apos;t be verified live is labeled honestly rather than shown as a false green.
      </p>
    </div>
  );
}
