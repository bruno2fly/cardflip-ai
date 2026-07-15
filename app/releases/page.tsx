"use client";
import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Bell, BellOff, Loader2, CalendarDays } from "lucide-react";

type ReleaseSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  logoUrl: string | null;
  symbolUrl: string | null;
  daysUntil?: number;
  daysAgo?: number;
};

type ReleasesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; upcoming: ReleaseSet[]; recent: ReleaseSet[] };

function daysBadgeCls(days: number): string {
  if (days <= 7) return "bg-red-950/60 border-red-700/50 text-red-400";
  if (days <= 14) return "bg-yellow-950/60 border-yellow-700/50 text-yellow-400";
  return "bg-gray-800 border-gray-700 text-gray-300";
}

function ReleaseCard({ set, alertOn, onToggle, borderCls }: {
  set: ReleaseSet;
  alertOn: boolean;
  onToggle: () => void;
  borderCls: string;
}) {
  const days = set.daysUntil ?? -(set.daysAgo ?? 0);
  const isPast = set.daysUntil == null;
  return (
    <div className={`bg-gray-900 border rounded-xl p-4 flex items-center gap-4 ${borderCls}`}>
      {/* Days-until badge */}
      <div className={`flex-shrink-0 w-16 h-16 rounded-xl border flex flex-col items-center justify-center ${isPast ? "bg-gray-800 border-gray-700 text-gray-400" : daysBadgeCls(days)}`}>
        <span className="text-xl font-extrabold tabular leading-none">{Math.abs(days)}</span>
        <span className="text-[9px] font-medium mt-0.5 uppercase tracking-wide">{isPast ? "days ago" : "days"}</span>
      </div>

      <div className="flex-1 min-w-0">
        {set.logoUrl ? (
          <div className="relative h-8 w-32 mb-1">
            <Image src={set.logoUrl} alt={set.name} fill className="object-contain object-left" sizes="128px" />
          </div>
        ) : null}
        <div className="text-white font-semibold text-sm leading-tight">{set.name}</div>
        <div className="text-gray-500 text-xs mt-0.5">{set.series} · releases {set.releaseDate}</div>
      </div>

      <button
        onClick={onToggle}
        className={`flex-shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
          alertOn
            ? "bg-yellow-400/10 border-yellow-400/50 text-yellow-400"
            : "bg-gray-800 border-gray-700 text-gray-500 hover:text-white"
        }`}
      >
        {alertOn ? <Bell size={11} /> : <BellOff size={11} />}
        Set Alert {alertOn ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function UpcomingReleases() {
  const [releases, setReleases] = useState<ReleasesState>({ status: "loading" });
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});

  const loadReleases = useCallback(async () => {
    setReleases({ status: "loading" });
    try {
      const res = await fetch("/api/releases");
      const json = await res.json();
      if (!res.ok || !json.upcoming) throw new Error();
      const all: ReleaseSet[] = [...json.upcoming, ...json.recent];
      const loadedAlerts: Record<string, boolean> = {};
      for (const s of all) loadedAlerts[s.id] = localStorage.getItem(`release-alert-${s.id}`) === "1";
      setAlerts(loadedAlerts);
      setReleases({ status: "ok", upcoming: json.upcoming, recent: json.recent });
    } catch {
      setReleases({ status: "error" });
    }
  }, []);

  useEffect(() => { loadReleases(); }, [loadReleases]);

  function toggleAlert(setId: string) {
    setAlerts(prev => {
      const next = !prev[setId];
      localStorage.setItem(`release-alert-${setId}`, next ? "1" : "0");
      return { ...prev, [setId]: next };
    });
  }

  const releaseGroups = releases.status === "ok" ? [
    { title: "Just dropped (last 7 days)", items: releases.recent, border: "border-green-800/50" },
    { title: "Dropping soon (≤14 days)", items: releases.upcoming.filter(s => (s.daysUntil ?? 999) <= 14), border: "border-red-700/60" },
    { title: "Coming up (15–60 days)", items: releases.upcoming.filter(s => { const d = s.daysUntil ?? 999; return d >= 15 && d <= 60; }), border: "border-yellow-700/50" },
    { title: "On the horizon (61–120 days)", items: releases.upcoming.filter(s => (s.daysUntil ?? 0) >= 61), border: "border-gray-700" },
  ].filter(g => g.items.length > 0) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <CalendarDays size={22} className="text-yellow-400" /> Upcoming Releases
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Every set dropping in the next 120 days. Pre-order early, flip after the print run ends.
        </p>
      </div>

      {releases.status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-500 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading release calendar…
        </div>
      )}
      {releases.status === "error" && (
        <div className="bg-red-950/40 border border-red-800/40 text-red-300 text-sm rounded-lg px-4 py-3">
          Couldn&apos;t load the release calendar.{" "}
          <button onClick={loadReleases} className="underline hover:text-white">Try again</button>
        </div>
      )}
      {releases.status === "ok" && releaseGroups.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm space-y-1">
          <CalendarDays size={28} className="mx-auto mb-2 opacity-40" />
          <p>No upcoming sets announced in the next 120 days.</p>
          <p>New sets usually get announced 2–3 months out — check back soon.</p>
        </div>
      )}
      {releaseGroups.map(group => (
        <div key={group.title} className="space-y-3">
          <h3 className="text-sm font-semibold text-white">{group.title}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {group.items.map(set => (
              <ReleaseCard
                key={set.id}
                set={set}
                borderCls={group.border}
                alertOn={!!alerts[set.id]}
                onToggle={() => toggleAlert(set.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {releases.status === "ok" && (
        <p className="text-gray-600 text-xs">
          Alerts with the toggle ON are emailed automatically 7 days before release (daily 9am check). The calendar refreshes every 6 hours.
        </p>
      )}
    </div>
  );
}
