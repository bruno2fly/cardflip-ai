"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Target, Package, Zap, Tag, Award, Boxes, Lock, BookOpen, Package2, CalendarDays, Archive, Activity, Menu, X, Radio, Eye } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Target;
  starterLocked?: boolean;
};

type NavSection = { title: string; items: NavItem[] };

const sections: NavSection[] = [
  {
    title: "Sealed Product",
    items: [
      { href: "/restocks", label: "🔴 Live Restocks", icon: Radio },
      { href: "/", label: "Sealed Products", icon: Package2 },
      { href: "/sealed-inventory", label: "Sealed Inventory", icon: Archive },
      { href: "/watchlist", label: "⭐ Watchlist", icon: Eye },
      { href: "/releases", label: "Upcoming Releases", icon: CalendarDays },
    ],
  },
  {
    title: "Single Cards",
    items: [
      { href: "/hunt", label: "Hunt List", icon: Target },
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/listings", label: "Listings", icon: Tag },
      { href: "/scanner", label: "Market Scanner", icon: Zap },
    ],
  },
  {
    title: "Card Tools",
    items: [
      { href: "/grading", label: "PSA Grading", icon: Award, starterLocked: true },
      { href: "/lot", label: "Lot Analyzer", icon: Boxes },
    ],
  },
  {
    title: "Learn",
    items: [
      { href: "/guide", label: "Guide", icon: BookOpen },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/status", label: "System Status", icon: Activity },
    ],
  },
];

export default function Sidebar() {
  const path = usePathname();
  const [starterMode, setStarterMode] = useState(false);
  // Mobile drawer open/closed. Closes automatically whenever the route changes.
  const [open, setOpen] = useState(false);
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

  return (
    <>
      {/* Mobile top bar — hidden on desktop. Holds the hamburger + logo. */}
      <header className="md:hidden fixed top-0 inset-x-0 h-14 z-40 bg-gray-900 border-b border-gray-800 flex items-center gap-3 px-4">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          className="text-gray-300 hover:text-white p-1 -ml-1"
        >
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-sm font-bold text-gray-900">🃏</div>
          <span className="font-bold text-white text-sm">CardFlip AI</span>
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
        className={`fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800 flex flex-col z-50 transform transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        {/* Logo (+ close button on mobile) */}
        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-lg font-bold text-gray-900">
              🃏
            </div>
            <div>
              <div className="font-bold text-white text-sm leading-tight">CardFlip AI</div>
              <div className="text-xs text-gray-500">Trading Intelligence</div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden text-gray-400 hover:text-white p-1"
          >
            <X size={20} />
          </button>
        </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-5">
        {sections.map(section => (
          <div key={section.title}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map(({ href, label, icon: Icon, starterLocked }) => {
                const active = path === href;

                // Starter Mode locks grading: no grading until the bankroll is built
                if (starterLocked && starterMode) {
                  return (
                    <div
                      key={href}
                      title="Unlock after 30 days"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 cursor-not-allowed select-none"
                    >
                      <Icon size={16} />
                      {label}
                      <Lock size={12} className="ml-auto" />
                    </div>
                  );
                }

                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/20"
                        : "text-gray-400 hover:text-white hover:bg-gray-800"
                    }`}
                  >
                    <Icon size={16} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* AI Agent Status */}
      <div className="p-4 border-t border-gray-800">
        <div className="bg-green-950/60 border border-green-800/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-green-400 pulse-dot inline-block" />
            <span className="text-green-400 text-xs font-semibold">AI Agent Active</span>
          </div>
          <div className="text-gray-400 text-xs">Scanning live markets</div>
          <div className="flex items-center gap-1 mt-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
            <span className="text-blue-400 text-xs">Live Markets</span>
          </div>
        </div>
      </div>
      </aside>
    </>
  );
}
