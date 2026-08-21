export type DropPattern = {
  retailer: string;
  eventType: "new-product-drop" | "restock-existing" | "general";
  window: string;
  peakDay?: string;
  confidence: "high" | "medium" | "low";
  note: string;
  source: string;
};

export const DROP_PATTERNS: DropPattern[] = [
  {
    retailer: "Target",
    eventType: "new-product-drop",
    window: "1:00–4:00 AM ET",
    confidence: "high",
    note: "Fresh SKUs tend to first appear overnight, with the heaviest activity around 3:00 AM ET (~245 detections over 90 days).",
    source: "restockd.app live tracker (90-day community-tracked history)",
  },
  {
    retailer: "Target",
    eventType: "restock-existing",
    window: "3:00–6:00 PM ET",
    peakDay: "Friday",
    confidence: "high",
    note: "Existing out-of-stock products most often return in the afternoon. Friday leads (~40%), followed by Monday (~19%) and Tuesday (~17%).",
    source: "restockd.app and community-tracked Target Pokémon restock history",
  },
  {
    retailer: "Walmart",
    eventType: "general",
    window: "1:00–5:00 PM ET",
    peakDay: "Wednesday",
    confidence: "medium",
    note: "Online drops are irregular, but Wednesday afternoons lead. Walmart+ members may sometimes receive early access.",
    source: "Community-observed “Walmart Wednesday” online drop pattern",
  },
  {
    retailer: "Pokémon Center",
    eventType: "general",
    window: "",
    confidence: "low",
    note: "No reliable day or time pattern is established; monitor continuously.",
    source: "Community tracking research; no repeatable schedule established",
  },
  {
    retailer: "Best Buy",
    eventType: "general",
    window: "",
    confidence: "low",
    note: "No reliable day or time pattern is established; monitor continuously.",
    source: "Community tracking research; no repeatable schedule established",
  },
];

const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const START_HOUR: Record<string, number> = {
  "1:00–4:00 AM ET": 1,
  "3:00–6:00 PM ET": 15,
  "1:00–5:00 PM ET": 13,
};

/**
 * Convert an Eastern wall-clock time to a Date. The noon probes make the
 * UTC-4/UTC-5 choice DST-aware enough for directional “heads up” windows;
 * this is not intended to be a precision scheduler.
 */
function easternDate(year: number, month: number, day: number, hour: number): Date {
  const noonUtc = new Date(Date.UTC(year, month, day, 12));
  const easternHourAtNoon = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(noonUtc));
  const offsetHours = easternHourAtNoon - 12;
  return new Date(Date.UTC(year, month, day, hour - offsetHours));
}

function easternParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")) - 1,
    day: Number(value("day")),
    weekday: DAY_INDEX[value("weekday")],
  };
}

/** Return scheduled patterns ordered by the next likely window opening. */
export function upcomingWindows(now: Date): { pattern: DropPattern; nextOccurrence: Date; hoursAway: number }[] {
  const today = easternParts(now);

  return DROP_PATTERNS.flatMap(pattern => {
    const startHour = START_HOUR[pattern.window];
    if (startHour == null) return [];

    let daysAhead = pattern.peakDay == null
      ? 0
      : (DAY_INDEX[pattern.peakDay] - today.weekday + 7) % 7;
    let next = easternDate(today.year, today.month, today.day + daysAhead, startHour);

    if (next.getTime() <= now.getTime()) {
      daysAhead += pattern.peakDay == null ? 1 : 7;
      next = easternDate(today.year, today.month, today.day + daysAhead, startHour);
    }

    return [{ pattern, nextOccurrence: next, hoursAway: (next.getTime() - now.getTime()) / 3_600_000 }];
  }).sort((a, b) => a.hoursAway - b.hoursAway);
}
