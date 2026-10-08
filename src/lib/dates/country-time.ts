/**
 * Country-local calendar logic for registration dates. Client-safe.
 *
 * Registries publish registration dates as calendar days in their own
 * country (e.g. "2026-10-04" in Norway). We store that day verbatim as
 * `registrationDay` (YYYY-MM-DD) and decide "today" in the country's
 * timezone — never the server's or the viewer's timezone, and never from
 * `createdAt` (which is when *we* imported the record).
 */

export type Day = string; // "YYYY-MM-DD"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is Day {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The calendar day it currently is in `timeZone` (e.g. "Europe/Oslo"). */
export function todayIn(timeZone: string, now: Date = new Date()): Day {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every day from `from` to `to` inclusive (capped). */
export function eachDay(from: Day, to: Day, max = 400): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing `day`. */
export function startOfWeek(day: Day): Day {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

/** Store a registry calendar day as a UTC-midnight Date (for sorting and range indexes). */
export function dayToDate(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Parse a registry date string ("2026-10-04", "2026-10-04T…", "20261004") into a Day, or undefined. */
export function toDay(value: string | undefined | null): Day | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d{8}$/.test(v)) return toDay(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
  const head = v.slice(0, 10);
  return isDay(head) ? head : undefined;
}

export function formatDay(day: Day, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(dayToDate(day));
}

export const DATE_PRESETS = ["today", "yesterday", "7d", "30d", "week", "month", "custom", "all"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  week: "This week",
  month: "This month",
  custom: "Custom range",
  all: "All dates",
};

export type DayRange = { preset: DatePreset; from?: Day; to?: Day; today: Day; label: string; singleDay?: Day };

/**
 * Resolve a date preset into an inclusive day range in the country's timezone.
 * "today" is the default everywhere. A specific day can be passed as
 * preset "custom" with from === to (used by the daily timeline).
 */
export function resolveDayRange(timeZone: string, preset: string | undefined, from?: string, to?: string, now = new Date()): DayRange {
  const today = todayIn(timeZone, now);
  const p = (DATE_PRESETS as readonly string[]).includes(preset ?? "") ? (preset as DatePreset) : "today";
  switch (p) {
    case "yesterday": {
      const d = addDays(today, -1);
      return { preset: p, from: d, to: d, today, singleDay: d, label: `yesterday (${formatDay(d, { day: "numeric", month: "short" })})` };
    }
    case "7d":
      return { preset: p, from: addDays(today, -6), to: today, today, label: "in the last 7 days" };
    case "30d":
      return { preset: p, from: addDays(today, -29), to: today, today, label: "in the last 30 days" };
    case "week":
      return { preset: p, from: startOfWeek(today), to: today, today, label: "this week" };
    case "month":
      return { preset: p, from: startOfMonth(today), to: today, today, label: "this month" };
    case "all":
      return { preset: p, today, label: "on any date" };
    case "custom": {
      const f = isDay(from) ? from : today;
      const t = isDay(to) ? to : f;
      const [a, b] = f <= t ? [f, t] : [t, f];
      if (a === b) return { preset: p, from: a, to: b, today, singleDay: a, label: a === today ? "today" : `on ${formatDay(a)}` };
      return { preset: p, from: a, to: b, today, label: `${formatDay(a, { day: "numeric", month: "short" })} – ${formatDay(b, { day: "numeric", month: "short", year: "numeric" })}` };
    }
    default:
      return { preset: "today", from: today, to: today, today, singleDay: today, label: "today" };
  }
}

/** Offset (ms) of `timeZone` from UTC at a given instant. */
function tzOffsetMs(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second")) - at.getTime();
}

/** UTC instant at which a local calendar day starts in `timeZone` (DST-safe). */
export function localDayStartUtc(day: Day, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let t = guess - tzOffsetMs(timeZone, new Date(guess));
  t = guess - tzOffsetMs(timeZone, new Date(t));
  return new Date(t);
}

/** [start, end) UTC bounds of an inclusive local day range. */
export function localRangeUtc(from: Day, to: Day, timeZone: string) {
  return { start: localDayStartUtc(from, timeZone), end: localDayStartUtc(addDays(to, 1), timeZone) };
}
