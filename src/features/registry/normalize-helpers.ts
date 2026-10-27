import type { NormalizedAddress } from "./types";

export const DIAL_CODES: Record<string, string> = { NO: "47", SE: "46", DK: "45", FI: "358", DE: "49", FR: "33", GB: "44", IE: "353", EE: "372", LV: "371", CH: "41", CZ: "420", PL: "48", US: "1", CA: "1", AU: "61", JP: "81" };

export function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.replace(/\s+/g, " ").trim();
  return v && v !== "[ND]" ? v : undefined;
}

export function cleanEmail(value: unknown): string | undefined {
  const v = clean(value)?.toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined;
}

/** Normalize a website to an absolute https URL (registries often omit the scheme). */
export function cleanWebsite(value: unknown): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return undefined;
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** Normalize a phone number to +<country><number> where the format allows it. */
export function cleanPhone(value: unknown, countryCode: string): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  let digits = v.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  // US / Canada (NANP) dial "011" for international numbers.
  if ((countryCode === "US" || countryCode === "CA") && digits.startsWith("011")) digits = `+${digits.slice(3)}`;
  if (!digits.startsWith("+")) {
    const dial = DIAL_CODES[countryCode];
    if (!dial) return v;
    if (dial === "1") {
      // NANP: 10 digits, optionally written with the leading "1" (1-800-…, 1 212 …). No trunk 0.
      if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
      if (digits.length !== 10 || /^[01]/.test(digits)) return v;
      digits = `+1${digits}`;
    } else {
      // National numbers with a trunk prefix (0) drop it after the country code.
      digits = `+${dial}${digits.replace(/^0/, "")}`;
    }
  }
  return /^\+\d{7,15}$/.test(digits) ? digits : v;
}

export function joinStreet(parts: (string | undefined | null)[]): string | undefined {
  const v = parts.map((p) => clean(p ?? undefined)).filter(Boolean).join(" ");
  return v || undefined;
}

export function formatAddress(a: NormalizedAddress | undefined): string | undefined {
  if (!a) return undefined;
  const line = [a.street, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return line || undefined;
}

export function titleCase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Registries often publish place names in upper case ("OSLO").
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
