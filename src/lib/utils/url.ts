/**
 * Safe external links for user-visible websites (client-safe).
 * Only http(s) URLs with a real host name are linked; `javascript:`, `data:`, `file:` and
 * other schemes, embedded credentials and malformed values are rejected (returned as null).
 */
export type SafeLink = { href: string; display: string };

const UNSAFE_CHARS = /[\s<>"'`\\]/;

export function safeExternalUrl(raw: string | null | undefined): SafeLink | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2048 || UNSAFE_CHARS.test(value)) return null;
  // A value with a scheme must be http(s); a bare host ("example.com/x") is assumed to be https.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".") || !/^[a-z0-9.-]+$/.test(host)) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return { href: url.toString(), display: `${host.replace(/^www\./, "")}${path}` };
}
