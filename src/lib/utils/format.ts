import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

function toDate(value: Date | string) {
  return typeof value === "string" ? new Date(value) : value;
}

export function formatDate(value: Date | string | undefined | null, pattern = "d MMM yyyy") {
  if (!value) return "—";
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, pattern);
}

export function formatDateTime(value: Date | string | undefined | null) {
  return formatDate(value, "d MMM yyyy, HH:mm");
}

export function formatRelative(value: Date | string | undefined | null) {
  if (!value) return "—";
  return formatDistanceToNowStrict(toDate(value), { addSuffix: true });
}

/** Compact timestamp for chat / inbox lists. */
export function formatShortTime(value: Date | string | undefined | null) {
  if (!value) return "";
  const d = toDate(value);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMM");
}

export function formatNumber(value: number | undefined | null) {
  return new Intl.NumberFormat("en-GB").format(value ?? 0);
}

export function formatPercent(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "WAITING_FOR_CLIENT" → "Waiting for client" */
export function humanize(value: string | undefined | null) {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
