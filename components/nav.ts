import {
  Target, Package, Zap, Tag, Award, Boxes, BookOpen, Package2, Archive, Activity, Eye, Crosshair, Bot,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Target;
  starterLocked?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    title: "Sealed Product",
    items: [
      { href: "/bot", label: "Buy Bot", icon: Bot },
      { href: "/restocks", label: "Drops", icon: Crosshair },
      { href: "/", label: "Sealed Products", icon: Package2 },
      { href: "/sealed-inventory", label: "Sealed Inventory", icon: Archive },
      { href: "/watchlist", label: "Watchlist", icon: Eye },
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

/** Breadcrumb for the top bar: section title + page label for a pathname. */
export function crumbFor(pathname: string): { section: string; page: string } {
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.href === pathname) return { section: section.title, page: item.label };
    }
  }
  return { section: "CardFlip", page: "" };
}
