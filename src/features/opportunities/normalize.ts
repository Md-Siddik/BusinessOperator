import crypto from "node:crypto";
import type { ServiceCategory } from "./constants";

/** Pure normalization helpers (no I/O). */

const TRACKING_PARAMS = /^(utm_[a-z]+|gh_src|gh_jid|source|src|ref|referrer|lever-source|lever-origin|fbclid|gclid|mc_cid|mc_eid|trk|ccuid)$/i;

/** Parse a URL, http(s) only. */
export function safeUrl(value: string | null | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value.trim().replace(/&amp;/g, "&"));
    return u.protocol === "http:" || u.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Clean an outbound URL for storage (decodes &amp;, drops tracking params). */
export function cleanUrl(value: string | null | undefined): string | undefined {
  const u = safeUrl(value);
  if (!u) return undefined;
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

/** Comparison key for a URL: host without www, path without trailing slash, sorted non-tracking params. */
export function canonicalUrlKey(value: string | null | undefined): string | undefined {
  const u = safeUrl(cleanUrl(value));
  if (!u) return undefined;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return `${host}${path}${params ? `?${params}` : ""}`;
}

export function hostOf(value: string | null | undefined): string | undefined {
  const u = safeUrl(value && !/^https?:\/\//i.test(value) ? `https://${value}` : value);
  return u?.hostname.toLowerCase().replace(/^www\./, "");
}

/** Registrable-ish domain: last two labels (three for common second-level ccTLDs like co.uk). */
export function registrableDomain(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const sld = parts.slice(-2).join(".");
  return /^(co|ac|gov|org|ltd|plc|net|me)\.uk$|^(com|gouv|asso)\.fr$/.test(sld) ? parts.slice(-3).join(".") : sld;
}

/** Hosts that never identify an organization (webmail, ATS, portals). */
const GENERIC_HOSTS = /(^|\.)(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|proton|protonmail|online|gmx|web|t-online|orange|free|wanadoo)\.[a-z.]+$|(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|linkedin\.com|facebook\.com|indeed\.[a-z.]+|adzuna\.[a-z.]+|arbetsformedlingen\.se|nav\.no|francetravail\.fr|ted\.europa\.eu|find-tender\.service\.gov\.uk|contractsfinder\.service\.gov\.uk|boamp\.fr)$/i;
export function isGenericHost(host: string | null | undefined) {
  return !host || GENERIC_HOSTS.test(host);
}

export function emailDomain(email: string | null | undefined) {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML (possibly entity-escaped, as Greenhouse returns) → readable plain text, capped. */
export function htmlToText(html: string | null | undefined, max = 4000): string | undefined {
  if (!html) return undefined;
  let s = html.includes("&lt;") ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(s, max);
}

export function truncate(s: string | null | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const LEGAL_SUFFIXES = /\b(as|asa|ab|publ|aps|a\/s|oy|oyj|gmbh|ag|kg|se|sa|sas|sarl|ltd|limited|plc|llp|inc|bv|nv|ug|e\.?v|ohg|ks|da|ans)\b\.?/gi;

/** Lower-case, accent-folded, legal-suffix-stripped name — for grouping and dedupe keys only. */
export function normalizeOrgName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const n = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return n || undefined;
}

export function normalizeTitle(title: string | null | undefined) {
  return (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sha1(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

/** Digits-only registration number (keeps the national format comparable). */
export function normalizeRegNumber(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.replace(/[\s.\-]/g, "").toUpperCase();
  return v || undefined;
}

/** Parse a date the source provided; returns undefined for anything unparseable (never "now"). */
export function parseSourceDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  // "2026-11-09+01:00" (date with offset, as TED publishes) → that day's end is NOT assumed; we keep the day start in that offset.
  const dateWithOffset = /^(\d{4}-\d{2}-\d{2})([+-]\d{2}:\d{2}|Z)$/.exec(v);
  const d = new Date(dateWithOffset ? `${dateWithOffset[1]}T00:00:00${dateWithOffset[2]}` : v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Deadline from a source value. Date-only values (no time) mean "by the end of that day"
 * in the publisher's offset — we store the END of the day so an opportunity is not
 * marked expired on its final day, and keep the original text for display.
 */
export function parseDeadline(value: unknown): { deadline?: Date; deadlineText?: string } {
  if (typeof value !== "string" || !value.trim()) return {};
  const v = value.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})([+-]\d{2}:\d{2}|Z)?$/.exec(v);
  if (dateOnly) {
    const d = new Date(`${dateOnly[1]}T23:59:59${dateOnly[2] ?? "Z"}`);
    return Number.isNaN(d.getTime()) ? { deadlineText: v } : { deadline: d, deadlineText: v };
  }
  const d = parseSourceDate(v);
  return d ? { deadline: d } : { deadlineText: v };
}

export function pickLang(value: unknown, prefer = ["eng", "en"]): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return pickLang(value[0], prefer);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const p of prefer) if (obj[p] !== undefined) return pickLang(obj[p], prefer);
    const first = Object.values(obj)[0];
    return pickLang(first, prefer);
  }
  return undefined;
}

export function uniq<T>(xs: (T | undefined | null)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x !== undefined && x !== null && x !== ""))];
}

/**
 * Service categories from PUBLISHED CPV codes (procurement). Prefix-based.
 * Only explicit classifications are mapped — nothing is inferred from a website's quality.
 */
const CPV_MAP: [string, ServiceCategory][] = [
  ["72413", "WEB_DEVELOPMENT"], // website design services
  ["72415", "WEB_DEVELOPMENT"], // website operation host services
  ["72212224", "WEB_DEVELOPMENT"], // web page editing software development
  ["72212517", "SOFTWARE_DEVELOPMENT"],
  ["72262", "SOFTWARE_DEVELOPMENT"], // software development services
  ["72230", "SOFTWARE_DEVELOPMENT"], // custom software development
  ["72212", "SOFTWARE_DEVELOPMENT"], // programming services of application software
  ["722", "SOFTWARE_DEVELOPMENT"], // software programming and consultancy
  ["48445", "CRM"], // customer relationship management software package
  ["7222", "IT_CONSULTING_SUPPORT"], // systems and technical consultancy
  ["7225", "IT_CONSULTING_SUPPORT"], // system and support services
  ["7261", "IT_CONSULTING_SUPPORT"], // computer support services
  ["726", "IT_CONSULTING_SUPPORT"],
  ["7231", "DATA_ANALYTICS"], // data-processing services
  ["7232", "DATA_ANALYTICS"], // database services
  ["7233", "DATA_ANALYTICS"], // content or data standardisation
  ["7931", "DATA_ANALYTICS"], // market research
  ["7934", "DIGITAL_MARKETING"], // advertising and marketing
  ["7941", "IT_CONSULTING_SUPPORT"], // business and management consultancy
  ["796", "RECRUITMENT_HR"], // recruitment services
  ["48", "SOFTWARE_DEVELOPMENT"], // software package and information systems
  ["72", "IT_CONSULTING_SUPPORT"],
];

export function serviceCategoriesFromCpv(codes: string[] | undefined): ServiceCategory[] {
  if (!codes?.length) return [];
  const out = new Set<ServiceCategory>();
  for (const code of codes) {
    const hit = CPV_MAP.find(([prefix]) => code.startsWith(prefix));
    if (hit) out.add(hit[1]);
  }
  return [...out];
}

/** Keyword rules over PUBLISHED titles (all languages we cover). Used only for relevance tags. */
const KEYWORDS: [RegExp, ServiceCategory][] = [
  [/\b(website|web ?site|nettside|hjemmeside|webbplats|hemsida|verkkosivu|site internet|webseite|homepage|web design|webdesign)\b/i, "WEB_DEVELOPMENT"],
  [/\b(e-?commerce|nettbutikk|webshop|webbutik|verkkokauppa|e-?boutique|onlineshop|online-shop)\b/i, "ECOMMERCE"],
  [/\b(crm|salesforce|hubspot|dynamics 365)\b/i, "CRM"],
  [/\b(seo|search engine optimi[sz]ation|sökmotoroptimering|søkemotoroptimalisering|référencement)\b/i, "SEO_DIGITAL_VISIBILITY"],
  [/\b(digital marketing|online marketing|social media|markedsføring|marknadsföring|markkinointi|marketing digital|sosiale medier)\b/i, "DIGITAL_MARKETING"],
  [/\b(automation|automatisering|automatisation|rpa|integration platform|erp)\b/i, "AUTOMATION_SYSTEMS"],
  [/\b(data analyst|analytics|business intelligence|power bi|data engineer|dataanalytiker|reporting)\b/i, "DATA_ANALYTICS"],
  [/\b(software|developer|utvikler|utvecklare|kehittäjä|développeur|entwickler|programmer|engineer|logiciel|progiciel|application mobile)\b/i, "SOFTWARE_DEVELOPMENT"],
  [/\b(informatique|infogérance|it-dienstleistung)\b/i, "IT_CONSULTING_SUPPORT"],
  [/\b(publicité|communication digitale|werbung)\b/i, "DIGITAL_MARKETING"],
  [/\b(it support|helpdesk|service desk|it consultant|it-konsult|it-konsulent|system administrator|devops)\b/i, "IT_CONSULTING_SUPPORT"],
  [/\b(recruit|rekrutter|rekryter|talent acquisition|hr partner|recrutement|personalvermittlung)\b/i, "RECRUITMENT_HR"],
];

export function serviceCategoriesFromText(...texts: (string | null | undefined)[]): ServiceCategory[] {
  const t = texts.filter(Boolean).join(" \n ");
  if (!t) return [];
  return uniq(KEYWORDS.filter(([re]) => re.test(t)).map(([, c]) => c));
}
