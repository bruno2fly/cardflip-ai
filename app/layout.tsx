import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

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
        <div className="flex min-h-screen">
          <Sidebar />
          {/* md:ml-64 clears the fixed sidebar on desktop; on mobile the sidebar
              is an off-canvas drawer, so main is full-width with room for the
              fixed top bar (pt-16). min-w-0 + overflow-x-hidden stop any wide
              child from forcing a horizontal scroll on small screens. */}
          <main className="flex-1 min-w-0 overflow-x-hidden p-4 pt-16 md:ml-64 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
