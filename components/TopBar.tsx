"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { crumbFor } from "@/components/nav";

/** v0 top bar: breadcrumb on the left, LOCAL/UTC clocks on the right. */
export default function TopBar() {
  const path = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const crumb = crumbFor(path);
  const local = now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
  const utc = now ? now.toISOString().slice(11, 19) : "--:--:--";

  return (
    <header className="hidden md:flex sticky top-0 z-30 h-16 items-center gap-4 px-10 border-b border-gray-800 bg-gray-950/95 backdrop-blur">
      <div className="flex items-center gap-2 text-[13px] text-gray-600">
        <span>{crumb.section}</span>
        {crumb.page && (
          <>
            <span aria-hidden="true">/</span>
            <b className="font-medium text-gray-300">{crumb.page}</b>
          </>
        )}
      </div>
      <div className="ml-auto flex gap-6 mono text-xs text-gray-500">
        <span>
          <em className="not-italic text-gray-600 text-[11px] tracking-[0.06em] mr-2">LOCAL</em>
          {local}
        </span>
        <span>
          <em className="not-italic text-gray-600 text-[11px] tracking-[0.06em] mr-2">UTC</em>
          {utc}
        </span>
      </div>
    </header>
  );
}
