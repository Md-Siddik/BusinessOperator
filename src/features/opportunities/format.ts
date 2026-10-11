import { getOpportunityCountry } from "@/config/opportunity-countries";

/**
 * Timestamps are stored in UTC. They are displayed in the opportunity's country time
 * zone (with the zone abbreviation), or UTC when no country applies. Client-safe.
 */
export function zoneFor(countryCode?: string | null) {
  return getOpportunityCountry(countryCode)?.timezone ?? "UTC";
}

export function formatInZone(value: Date | string | null | undefined, timeZone = "UTC", withTime = true): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime && { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }),
  }).format(d);
}

export function formatAge(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const d = typeof value === "string" ? new Date(value) : value;
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const txt = a < 90 ? `${a} s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 129_600 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86_400)} d`;
  return future ? `in ${txt}` : `${txt} ago`;
}

export function formatInterval(minutes: number) {
  return minutes >= 60 ? `every ${Math.round((minutes / 60) * 10) / 10} h` : `every ${minutes} min`;
}
