import { createHmac } from "node:crypto";
import { LANGUAGE_CODES } from "@/config/languages";

/**
 * Pure helpers for website analytics (no I/O). Documented in docs/website-analytics.md.
 */

/** A visit ends after this much inactivity; the next page view starts a new session. */
export const SESSION_TIMEOUT_MS = 30 * 60_000;
/** Browser cookies. `et_consent` remembers the visitor's choice; `et_vid` exists only after "Accept". */
export { CONSENT_COOKIE } from "@/lib/consent";
export const VISITOR_COOKIE = "et_vid";
/** 13 months — the usual upper bound for an analytics cookie in Europe. */
export const VISITOR_COOKIE_MAX_AGE = 395 * 86_400;
export const VISITOR_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

export const CHANNELS = ["email", "google", "search", "linkedin", "facebook", "instagram", "social", "referral", "campaign", "direct"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  google: "Google",
  search: "Other search",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  social: "Other social",
  referral: "Other referral",
  campaign: "Other campaign",
  direct: "Direct / unknown",
};

export type Utm = { source?: string; medium?: string; campaign?: string; term?: string; content?: string };

/**
 * Obvious automated traffic: crawlers, link-preview fetchers, uptime monitors, headless
 * browsers and HTTP libraries. Deliberately conservative — an unusual but real browser is
 * still counted. (The tracker also only runs from JavaScript, which most crawlers never execute.)
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|facebookcatalog|embedly|quora link preview|whatsapp|telegrambot|skypeuripreview|bitlybot|headlesschrome|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|site24x7|newrelicpinger|datadog|monitor|preview|python-requests|python-urllib|aiohttp|httpx|axios|node-fetch|undici|got \(|curl\/|wget|go-http-client|java\/|okhttp|libwww|scrapy|feedfetcher|validator/i;

export function isBot(userAgent: string | null | undefined, webdriver = false): boolean {
  if (webdriver) return true;
  const ua = (userAgent ?? "").trim();
  if (ua.length < 10) return true;
  return BOT_UA.test(ua);
}

/** Reporting time zone: every analytics day, chart and export is a Norwegian calendar day. */
export const ANALYTICS_TIME_ZONE = "Europe/Oslo";

export const DEVICES = ["desktop", "mobile", "tablet"] as const;
export type Device = (typeof DEVICES)[number];

/** Coarse device class from the user agent (no model, no screen size — not a fingerprint). */
export function deviceCategory(userAgent: string | null | undefined): Device {
  const ua = userAgent ?? "";
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone|blackberry|opera mini/i.test(ua)) return "mobile";
  return "desktop";
}

/** Browser family only (no version). */
export function browserFamily(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

const clip = (v: string | null | undefined, max: number) => {
  const s = (v ?? "").replace(/[\u0000-\u001f]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
};

export function parseUtm(params: URLSearchParams): Utm | undefined {
  const utm: Utm = {
    source: clip(params.get("utm_source"), 100)?.toLowerCase(),
    medium: clip(params.get("utm_medium"), 100)?.toLowerCase(),
    campaign: clip(params.get("utm_campaign"), 150),
    term: clip(params.get("utm_term"), 150),
    content: clip(params.get("utm_content"), 150),
  };
  return Object.values(utm).some(Boolean) ? (Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as Utm) : undefined;
}

/** Referrer reduced to origin + path (query strings can hold personal data), and its domain. */
export function parseReferrer(referrer: string | null | undefined, siteHost: string): { referrer?: string; referrerDomain?: string; internal: boolean } {
  if (!referrer) return { internal: false };
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return { internal: false };
    const domain = u.hostname.toLowerCase().replace(/^www\./, "");
    const own = siteHost.toLowerCase().split(":")[0]!.replace(/^www\./, "");
    if (domain === own) return { internal: true };
    return { referrer: clip(`${u.origin}${u.pathname}`, 300), referrerDomain: domain, internal: false };
  } catch {
    return { internal: false };
  }
}

const WEBMAIL = /^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|(web)?mail\.[a-z0-9.-]+)$/;
const SEARCH =/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|kvasir\.no|yandex\.[a-z]+|baidu\.com|qwant\.com|startpage\.com|search\.brave\.com|seznam\.cz)$/;
const SOCIAL = /(^|\.)(x\.com|twitter\.com|t\.co|youtube\.com|pinterest\.[a-z]+|reddit\.com|tiktok\.com|threads\.net|snapchat\.com|bsky\.app|mastodon\.social)$/;

/** Marketing channel of an arrival: UTM tags first, then the referring domain. */
export function channelFor(utm: Utm | undefined, referrerDomain: string | undefined): Channel {
  const src = utm?.source ?? "";
  const med = utm?.medium ?? "";
  if (med === "email" || med === "outreach" || med === "newsletter" || src === "email" || src === "newsletter") return "email";
  const domain = referrerDomain ?? "";
  // A click inside webmail (Gmail, Outlook, …) is an email visit, not a Google/Microsoft one.
  if (WEBMAIL.test(domain)) return "email";
  const by =(name: string) => src.includes(name) || new RegExp(`(^|\\.)${name}\\.`).test(domain) || domain === `${name}.com`;
  if (by("google")) return "google";
  if (by("linkedin") || domain === "lnkd.in") return "linkedin";
  if (by("facebook") || domain === "fb.com" || domain === "m.facebook.com" || domain === "l.facebook.com") return "facebook";
  if (by("instagram")) return "instagram";
  if (SEARCH.test(domain) || ["bing", "duckduckgo", "yahoo", "ecosia", "kvasir"].includes(src)) return "search";
  if (SOCIAL.test(domain) || ["twitter", "x", "youtube", "tiktok", "reddit", "pinterest", "social"].includes(src) || med === "social") return "social";
  if (utm) return "campaign";
  if (domain) return "referral";
  return "direct";
}

/** Public-site path, split into its language prefix and language-neutral page. Null for non-site paths. */
export function parsePath(raw: string | null | undefined): { path: string; page: string; locale: string; search: URLSearchParams; serviceSlug?: string } | null {
  if (!raw || typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let u: URL;
  try {
    u = new URL(raw, "http://site.local");
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "") || "/";
  if (path.length > 300 || /^\/(api|dashboard|staff|portal|_next)(\/|$)/.test(path)) return null;
  const [, first = "", ...rest] = path.split("/");
  const localized = (LANGUAGE_CODES as readonly string[]).includes(first);
  const locale = localized ? first : "en";
  const page = localized ? `/${rest.join("/")}`.replace(/\/$/, "") || "/" : path;
  const m = /^\/services\/([a-z0-9-]{1,80})$/.exec(page);
  return { path, page, locale, search: u.searchParams, serviceSlug: m?.[1] };
}

/**
 * Adds UTM tags to a link on our own site (outreach emails), so Website Analytics can credit the
 * campaign. The tags name the campaign, never the recipient. Other domains are left unchanged.
 */
export function withCampaign(url: string, siteDomain: string, utm: { source: string; medium: string; campaign: string }): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== siteDomain.toLowerCase().replace(/^www\./, "") || u.searchParams.has("utm_source")) return url;
    u.searchParams.set("utm_source", utm.source);
    u.searchParams.set("utm_medium", utm.medium);
    u.searchParams.set("utm_campaign", utm.campaign);
    return u.toString();
  } catch {
    return url;
  }
}

function secret() {
  return process.env.ANALYTICS_SECRET || process.env.AUTH_SECRET || "et-analytics-dev-secret";
}

/** What the database stores instead of the cookie value: an HMAC, so a leaked database cannot be matched to browsers. */
export function hashVisitorId(vid: string): string {
  return createHmac("sha256", secret()).update(`vid:${vid}`).digest("base64url");
}

/** Display code for an anonymous visitor ("A82F"): stable per visitor, meaningless outside the dashboard. */
export function visitorLabel(vidHash: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[vidHash.charCodeAt(i * 3) % alphabet.length];
  return out;
}
