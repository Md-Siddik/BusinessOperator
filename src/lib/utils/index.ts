import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function initials(name: string | undefined | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function truncate(input: string, length: number) {
  return input.length > length ? `${input.slice(0, length - 1)}…` : input;
}

export function normalizeWebsite(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function domainFromEmail(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function domainFromUrl(url: string | undefined | null) {
  if (!url) return "";
  try {
    return new URL(normalizeWebsite(url)!).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Serialize Mongo documents (ObjectId, Date) into plain JSON for client components. */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
