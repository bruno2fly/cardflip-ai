import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "CardFlip — Private sealed product terminal",
  description: "Watches Target and Pokémon Center around the clock and checks out for you the moment an item restocks at or under your price cap.",
};

// Correct mobile scaling — without this, phones render the page at desktop width.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0B0C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-gray-950 text-gray-200 min-h-screen antialiased">
        {/* AppShell gates on Supabase Auth: shows the login screen when signed
            out, and the Sidebar + page (this layout's `children`) when signed
            in. The responsive shell (drawer nav, mobile-safe main margins)
            lives inside AppShell now. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
