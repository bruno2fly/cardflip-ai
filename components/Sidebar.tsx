"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { navSections } from "@/components/nav";

type SidebarProps = { userEmail?: string | null; onSignOut?: () => void };

/** The v0 "private terminal" sidebar: CF mark, quiet groups, gold active icon. */
export default function Sidebar({ userEmail, onSignOut }: SidebarProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [starterMode, setStarterMode] = useState(false);
  const [agent, setAgent] = useState<{ online: boolean; heartbeat: string | null } | null>(null);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setOpen(false); }, [path]);

  // Track Starter Mode (set on the Hunt List page) without a reload
  useEffect(() => {
    const read = () => setStarterMode(localStorage.getItem("cardflip-starter-mode") === "1");
    read();
    window.addEventListener("cardflip-starter-change", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("cardflip-starter-change", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // Lightweight agent heartbeat for the connection card (fail-open, silent)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/bot", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setAgent({ online: !!data?.agentOnline, heartbeat: data?.config?.agentHeartbeat ?? null });
      } catch { /* sidebar stays quiet about it */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function timeAgo(iso: string | null): string {
    if (!iso) return "—";
    const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  }

  const initials = (userEmail ?? "")
    .split("@")[0]
    .split(/[^a-z]/i)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join("") || "CF";

  return (
    <>
      {/* Mobile top bar — hidden on desktop. Holds the hamburger + brand. */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 z-40 bg-gray-950/95 backdrop-blur border-b border-gray-800 flex items-center gap-3 px-4">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          className="text-gray-400 hover:text-gray-200 p-1 -ml-1"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2.5">
          <BrandMark size={26} />
          <span className="font-medium text-gray-200 text-sm tracking-tight">CardFlip</span>
        </div>
      </header>

      {/* Backdrop behind the open drawer (mobile only) */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full w-[248px] bg-gray-950 border-r border-gray-800 flex flex-col overflow-y-auto z-50 transform transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        {/* Brand */}
        <div className="h-16 px-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <BrandMark size={28} />
            <div className="leading-tight">
              <div className="font-medium text-gray-200 text-[15px] tracking-tight">CardFlip</div>
              <div className="text-[11px] text-gray-600 tracking-wide">Private terminal</div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden text-gray-500 hover:text-gray-300 p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="px-3 pb-4">
          {navSections.map(section => (
            <div key={section.title} className="pt-5 first:pt-1">
              <div className="px-3 pb-2 text-[11px] text-gray-600 uppercase tracking-[0.08em]">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon, starterLocked }) => {
                  const active = path === href;

                  // Starter Mode locks grading: no grading until the bankroll is built
                  if (starterLocked && starterMode) {
                    return (
                      <div
                        key={href}
                        title="Unlock after 30 days"
                        className="flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] font-medium text-gray-600 cursor-not-allowed select-none"
                      >
                        <Icon size={15} strokeWidth={1.5} />
                        {label}
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-600">locked</span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors ${
                        active
                          ? "bg-gray-800 text-gray-200 shadow-hi"
                          : "text-gray-500 hover:text-gray-300 hover:bg-gray-900"
                      }`}
                    >
                      <Icon size={15} strokeWidth={1.5} className={active ? "text-yellow-400" : ""} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Connection card */}
        <div className="mt-auto mx-3 mb-3 px-3.5 py-3 border border-gray-800 rounded-lg bg-gray-900 shadow-hi space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Agent</span>
            <span className={`flex items-center gap-1.5 font-medium ${agent?.online ? "text-green-400" : "text-gray-500"}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${agent?.online ? "bg-green-400 pulse-dot" : "bg-gray-600"}`} />
              {agent?.online ? "Online" : agent ? "Offline" : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Heartbeat</span>
            <span className="mono text-[11px] text-gray-300">{timeAgo(agent?.heartbeat ?? null)}</span>
          </div>
        </div>

        {/* Account */}
        {userEmail && (
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-t border-gray-800">
            <div className="w-7 h-7 rounded-full bg-gray-700 grid place-items-center text-[11px] font-medium text-gray-400 shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13px] text-gray-300 font-medium truncate" title={userEmail}>{userEmail}</div>
            </div>
            <button
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors p-1"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

/** The CF monogram — gold hairline box, mono letters, no gradients. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-lg border border-yellow-400/30 grid place-items-center mono font-medium text-yellow-400 shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), letterSpacing: "0.02em" }}
    >
      CF
    </div>
  );
}
