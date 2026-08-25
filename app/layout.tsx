import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CardFlip AI — Pokemon Card Trading Intelligence",
  description: "AI-powered Pokemon card flip tracking and market scanner",
};

// Correct mobile scaling — without this, phones render the page at desktop width.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030712",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        {/* AppShell gates on Supabase Auth: shows the login screen when signed
            out, and the Sidebar + page (this layout's `children`) when signed
            in. The responsive shell (drawer nav, mobile-safe main margins)
            lives inside AppShell now. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
