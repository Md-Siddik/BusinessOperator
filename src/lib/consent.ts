/**
 * Cookie consent record (client-safe, no dependencies). One first-party cookie, `et_consent`,
 * holds the decision with its policy version, timestamp and categories:
 *
 *   et_consent = <granted|denied>.<version>.<unix seconds>.<category+category>
 *   e.g. "granted.2.1793174400.essential+analytics" · "denied.2.1793174400.essential"
 *
 * A record is valid only for the current CONSENT_VERSION and for CONSENT_MAX_AGE_DAYS; anything
 * else (missing, malformed, an older version such as the earlier bare "granted", expired, or
 * dated in the future) counts as "no decision": the dialog asks again and nothing optional runs.
 * Essential cookies (sign-in, security, language, this decision) never need consent.
 */
export const CONSENT_COOKIE = "et_consent";
/** Bump when the cookie policy changes in a way that needs a new decision. */
export const CONSENT_VERSION = 2;
export const CONSENT_MAX_AGE_DAYS = 395;
export const CONSENT_MAX_AGE_SECONDS = CONSENT_MAX_AGE_DAYS * 86_400;
export const CONSENT_CATEGORIES = ["essential", "analytics"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type ConsentStatus = "granted" | "denied";
export type ConsentRecord = { status: ConsentStatus; version: number; at: number; categories: ConsentCategory[] };

/** Categories each decision enables. Deny keeps only what the site needs to work. */
export function categoriesFor(status: ConsentStatus): ConsentCategory[] {
  return status === "granted" ? ["essential", "analytics"] : ["essential"];
}

export function createConsent(status: ConsentStatus, now = Date.now()): ConsentRecord {
  return { status, version: CONSENT_VERSION, at: Math.floor(now / 1000), categories: categoriesFor(status) };
}

export function serializeConsent(r: ConsentRecord) {
  return `${r.status}.${r.version}.${r.at}.${r.categories.join("+")}`;
}

/** The stored decision, or null when there is no valid decision under the current policy. */
export function parseConsent(raw: string | null | undefined, now = Date.now()): ConsentRecord | null {
  if (!raw) return null;
  const m = /^(granted|denied)\.(\d{1,4})\.(\d{9,11})\.([a-z+]{1,64})$/.exec(raw);
  if (!m) return null;
  const version = Number(m[2]);
  const at = Number(m[3]);
  if (version !== CONSENT_VERSION) return null;
  const nowS = Math.floor(now / 1000);
  if (at > nowS + 300 || nowS - at > CONSENT_MAX_AGE_SECONDS) return null;
  const categories = m[4]!.split("+");
  if (!categories.every((c): c is ConsentCategory => (CONSENT_CATEGORIES as readonly string[]).includes(c))) return null;
  const status = m[1] as ConsentStatus;
  // A record must say exactly what its decision enables.
  const expected = categoriesFor(status);
  if (categories.length !== expected.length || !expected.every((c) => categories.includes(c))) return null;
  return { status, version, at, categories: expected };
}

/** Optional analytics may run only with a valid, current "granted" decision. */
export function hasAnalyticsConsent(raw: string | null | undefined, now = Date.now()) {
  const r = parseConsent(raw, now);
  return !!r && r.status === "granted" && r.categories.includes("analytics");
}

/** Read the decision from a `document.cookie` string. */
export function consentFromCookieHeader(cookieHeader: string, now = Date.now()) {
  const m = /(?:^|;\s*)et_consent=([^;]*)/.exec(cookieHeader);
  return parseConsent(m ? decodeURIComponent(m[1]!) : null, now);
}
