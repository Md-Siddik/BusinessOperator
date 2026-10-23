import { Download } from "lucide-react";
import { LinkTabs, withParams } from "@/components/ui/data";
import { buttonClasses } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { DATE_PRESET_LABELS } from "@/lib/dates/country-time";
import { ANALYTICS_PRESETS, ANALYTICS_TIME_ZONE, type VisitorStatus } from "@/features/website-analytics/service";
import type { Geo } from "@/features/website-analytics/geo";

export const ANALYTICS_PATH = "/dashboard/website-analytics";
type SP = Record<string, string | undefined>;

const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: ANALYTICS_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone: ANALYTICS_TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** Dates are shown in Norwegian time, whatever the server's timezone. */
export const fmtDateTime = (d: Date | string) => dateTime.format(new Date(d));
export const fmtTime = (d: Date | string) => time.format(new Date(d));

export function fmtDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const fmtRate = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`);

/* ── Location and local time ── */

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code?: string) {
  if (!code) return "Unknown location";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}
/** The country's flag emoji (decorative). */
export const flagOf = (code?: string) => (code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");

/** "Oslo, Oslo County, Norway" — the most specific parts known, without repeating a city that is also the region. */
export function fmtLocation(geo?: Geo, opts: { countryOnly?: boolean } = {}) {
  if (!geo?.country) return "Unknown location";
  const country = countryName(geo.country);
  if (opts.countryOnly) return country;
  const parts = [geo.city, geo.region && geo.region !== geo.city ? geo.region : undefined, country].filter(Boolean);
  return parts.join(", ");
}

export function Location({ geo, countryOnly }: { geo?: Geo; countryOnly?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden>{flagOf(geo?.country)}</span>
      <span className={geo?.country ? "truncate" : "truncate text-ink-400"}>{fmtLocation(geo, { countryOnly })}</span>
    </span>
  );
}

/** The visitor's own local time, when their browser is not on Norwegian time: "03:42 (New York)". */
export function fmtLocalTime(at: Date | string, timeZone?: string) {
  if (!timeZone || timeZone === ANALYTICS_TIME_ZONE) return null;
  try {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(at));
    const sameDay = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(new Date(at)) === new Intl.DateTimeFormat("en-GB", { timeZone: ANALYTICS_TIME_ZONE, day: "numeric" }).format(new Date(at));
    const place = timeZone.split("/").pop()!.replace(/_/g, " ");
    return `${t}${sameDay ? "" : ` (${new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(new Date(at))})`} local · ${place}`;
  } catch {
    return null;
  }
}

const STATUS_TONE: Record<VisitorStatus, BadgeTone> = { Lead: "success", Authenticated: "brand", Returning: "info", New: "neutral" };
export function VisitorStatusBadge({ status }: { status: VisitorStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status === "New" ? "Anonymous" : status}</Badge>;
}

/** Preset tabs plus a plain GET form for a custom range (no client script needed). */
export function RangeBar({ sp, range }: { sp: SP; range: { preset: string; from?: string; to?: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <LinkTabs
        active={range.preset}
        tabs={ANALYTICS_PRESETS.filter((p) => p !== "custom").map((p) => ({ id: p, label: DATE_PRESET_LABELS[p], href: withParams(ANALYTICS_PATH, sp, { range: p === "7d" ? null : p, from: null, to: null, page: null }) }))}
      />
      <form action={ANALYTICS_PATH} method="get" className="flex flex-wrap items-center gap-2 text-sm">
        {sp.tab && <input type="hidden" name="tab" value={sp.tab} />}
        <input type="hidden" name="range" value="custom" />
        <label className="sr-only" htmlFor="wa-from">From</label>
        <input id="wa-from" type="date" name="from" defaultValue={range.preset === "custom" ? range.from : undefined} required className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800" />
        <span className="text-ink-400" aria-hidden>–</span>
        <label className="sr-only" htmlFor="wa-to">To</label>
        <input id="wa-to" type="date" name="to" defaultValue={range.preset === "custom" ? range.to : undefined} className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-800" />
        <button type="submit" className={buttonClasses(range.preset === "custom" ? "dark" : "outline", "sm")}>
          Custom range
        </button>
      </form>
    </div>
  );
}

/** Direct download links — the export API checks the Owner role itself. */
export function ExportLinks({ range }: { range: { preset: string; from?: string; to?: string } }) {
  const q = new URLSearchParams({ range: "custom", from: range.from ?? "", to: range.to ?? "" });
  const kinds = [
    ["visitors", "Visitors"],
    ["sessions", "Sessions"],
    ["pageviews", "Page views"],
    ["sources", "Sources"],
    ["campaigns", "Campaigns"],
    ["locations", "Locations"],
  ] as const;
  return (
    <details className="relative">
      <summary className={buttonClasses("outline", "sm", "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        <Download className="h-4 w-4" aria-hidden /> Export CSV
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-ink-200 bg-white p-1 shadow-lifted">
        {kinds.map(([kind, label]) => (
          <a key={kind} href={`/api/website-analytics/export?kind=${kind}&${q}`} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
            {label}
          </a>
        ))}
      </div>
    </details>
  );
}
