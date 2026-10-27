import "server-only";
import { cleanEmail, cleanPhone, cleanWebsite } from "@/features/registry/normalize-helpers";
import { fetchPublicPage, type PageResult } from "@/features/intelligence/safe-fetch";
import { isWebmail } from "@/lib/company-fields";

/**
 * Official-website research. Treats every page as untrusted data: only
 * contact values are extracted (no instructions are followed, nothing is executed).
 * Polite: robots.txt, public hosts only, size + time limits, bounded page count.
 */

const CONTACT_PATH = /(contact|kontakt|kontakta|yhteys|ota-yhteytta|contacto|contatti|contato|impressum|imprint|legal|mentions-legales|mentions|about|om-oss|om_oss|omoss|tietoa|uber-uns|ueber-uns|team|tiimi|people|a-propos|qui-sommes-nous|nous-contacter|o-nas|par-mums|chi-siamo)/i;
const CONTACT_LABEL = /(contact|kontakt|yhteys|impressum|imprint|legal notice|mentions|about|om oss|tietoa meistä|über uns|team|à propos|nous contacter|o nás|par mums|kontakti)/i;

/**
 * Country domains tried for website discovery, most common first. Every candidate is still
 * verified on the page itself (registration number or exact legal name) before it is used.
 * US, CA and AU registries publish no website or email at all, so discovery is their main
 * free route to a public business contact.
 */
export const TLDS: Record<string, string[]> = {
  NO: ["no"],
  SE: ["se"],
  DK: ["dk"],
  FI: ["fi"],
  DE: ["de"],
  FR: ["fr"],
  GB: ["co.uk", "uk"],
  IE: ["ie"],
  NL: ["nl"],
  EE: ["ee"],
  LV: ["lv"],
  CH: ["ch"],
  CZ: ["cz"],
  PL: ["pl", "com.pl"],
  US: ["com"],
  CA: ["ca", "com"],
  AU: ["com.au", "au"],
  JP: ["co.jp", "jp"],
};

/** Quotes differ between registers and websites (SIA "Vastium" vs SIA „Vastium“ vs SIA Vastium). */
const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&quot;|&#34;|&#8220;|&#8221;|&#8222;|["“”„«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function textOf(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Does the page identify this legal entity? Registration number is strong; exact legal name is weaker. */
export function identityEvidence(html: string, company: { companyName: string; registrationNumber?: string | null }): "REGISTRATION_NUMBER" | "EXACT_NAME" | null {
  const text = normName(textOf(html));
  if (company.registrationNumber) {
    const reg = company.registrationNumber.replace(/[\s.-]/g, "").toLowerCase();
    if (reg.length >= 6 && text.replace(/[\s.-]/g, "").includes(reg)) return "REGISTRATION_NUMBER";
  }
  const name = normName(company.companyName);
  if (name.length >= 6 && text.includes(name)) return "EXACT_NAME";
  return null;
}

export type ExtractedContacts = {
  emails: { value: string; url: string; onOwnDomain: boolean; webmail: boolean }[];
  phones: { value: string; url: string; via: "tel-link" | "text" | "structured-data" }[];
  forms: string[];
  links: string[];
  /** People the site itself names with a role in schema.org structured data (never guessed from prose). */
  people: { name: string; role: string; url: string }[];
};

type JsonLd = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : undefined);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const isType = (o: JsonLd, t: string) => asList(o["@type"]).some((x) => typeof x === "string" && x.toLowerCase() === t.toLowerCase());

/**
 * Subtrees that describe OTHER parties (a theme's publisher, an article author, a brand or
 * manufacturer, a reviewer …) — their contact values never belong to the company.
 */
const THIRD_PARTY_KEYS = new Set(["publisher", "author", "creator", "provider", "brand", "manufacturer", "sponsor", "funder", "review", "reviews", "itemReviewed", "isPartOf", "copyrightHolder", "parentOrganization", "subOrganization", "sameAs", "potentialAction"]);

/** Objects in the page's JSON-LD blocks, excluding third-party subtrees (bounded; malformed blocks ignored). */
export function jsonLdObjects(html: string): JsonLd[] {
  const out: JsonLd[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || out.length > 200 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    out.push(v as JsonLd);
    for (const [k, x] of Object.entries(v as JsonLd)) if (x && typeof x === "object" && !THIRD_PARTY_KEYS.has(k)) walk(x, depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]{0,200000}?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]!.trim()), 0);
    } catch {
      /* not valid JSON — ignored */
    }
  }
  return out;
}

/** A plausible personal name: 2–5 words, letters only, 4–80 characters. */
const PERSON_NAME = /^[\p{L}][\p{L}'’.-]*(?: [\p{L}][\p{L}'’.-]*){1,4}$/u;

export function extractFromPage(html: string, pageUrl: string, countryCode: string): ExtractedContacts {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const out: ExtractedContacts = { emails: [], phones: [], forms: [], links: [], people: [] };
  const emailSeen = new Set<string>();
  const addEmail = (raw: string) => {
    const e = cleanEmail(raw);
    if (!e || emailSeen.has(e)) return;
    emailSeen.add(e);
    const domain = e.split("@")[1]!;
    out.emails.push({ value: e, url: pageUrl, onOwnDomain: domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`), webmail: isWebmail(e) });
  };
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) addEmail(decodeURIComponent(m[1]!));
  for (const m of textOf(html).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) addEmail(m[0]);

  const localSite = (TLDS[countryCode] ?? []).some((tld) => host.endsWith(`.${tld}`));
  const phoneSeen = new Set<string>();
  const addPhone = (raw: string, via: ExtractedContacts["phones"][number]["via"]) => {
    const r = raw.trim();
    if (!/^(\+|00)/.test(r) && !localSite) return; // national formats only on sites in the company's country
    const p = cleanPhone(r, countryCode);
    if (!p || !/^\+\d{7,15}$/.test(p) || phoneSeen.has(p)) return;
    phoneSeen.add(p);
    out.phones.push({ value: p, url: pageUrl, via });
  };
  for (const m of html.matchAll(/href=["']tel:([^"']+)/gi)) addPhone(decodeURIComponent(m[1]!), "tel-link");
  for (const m of textOf(html).matchAll(/(?:tel|phone|telefon|puh|puhelin|tél|téléphone|mob|mobil|gsm|ring|tālr|tālrunis)\.?\s*[:.]?\s*(\+?\(?\d[\d\s().-]{6,18}\d)/gi)) addPhone(m[1]!.replace(/[()]/g, ""), "text");

  // schema.org structured data the site publishes about itself: Organization / LocalBusiness
  // email, telephone and contactPoint values, and Person entries that carry an explicit role.
  for (const o of jsonLdObjects(html)) {
    if (isType(o, "Person")) {
      const name = str(o.name);
      const role = str(o.jobTitle) ?? str(o.roleName);
      if (name && role && name.length >= 4 && name.length <= 80 && PERSON_NAME.test(name) && role.length <= 80 && !out.people.some((p) => p.name === name)) out.people.push({ name, role, url: pageUrl });
      continue;
    }
    const email = str(o.email)?.replace(/^mailto:/i, "");
    if (email) addEmail(email);
    const tel = str(o.telephone);
    if (tel) addPhone(tel.replace(/^tel:/i, ""), "structured-data");
  }
  out.people = out.people.slice(0, 5);

  for (const m of html.matchAll(/<form\b[\s\S]{0,4000}?<\/form>/gi)) {
    if (/<textarea|type=["']?email/i.test(m[0])) {
      out.forms.push(pageUrl);
      break;
    }
  }
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1]!;
    const label = m[2]!.replace(/<[^>]+>/g, "");
    if (!CONTACT_PATH.test(href) && !CONTACT_LABEL.test(label)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.hostname.replace(/^www\./, "") === host && /^https?:$/.test(u.protocol)) out.links.push(u.toString().split("#")[0]!);
    } catch {
      /* ignore malformed */
    }
  }
  out.links = [...new Set(out.links)];
  return out;
}

export type WebsiteResearch = {
  website: string;
  reachable: boolean;
  error?: string;
  identity: "REGISTRATION_NUMBER" | "EXACT_NAME" | null;
  pagesChecked: string[];
  emails: ExtractedContacts["emails"];
  phones: ExtractedContacts["phones"];
  forms: string[];
  people: ExtractedContacts["people"];
};

/** Read the homepage and up to maxPages contact-type pages of one website. */
export async function researchWebsite(rawUrl: string, company: { companyName: string; registrationNumber?: string | null; countryCode: string }, maxPages = 5, cache?: Map<string, PageResult>): Promise<WebsiteResearch> {
  const website = cleanWebsite(rawUrl) ?? rawUrl;
  const result: WebsiteResearch = { website, reachable: false, identity: null, pagesChecked: [], emails: [], phones: [], forms: [], people: [] };
  const home = await fetchPublicPage(website, { cache });
  if ("error" in home) return { ...result, error: home.error };
  result.reachable = true;
  result.pagesChecked.push(home.url);
  let identity = identityEvidence(home.html, company);
  const first = extractFromPage(home.html, home.url, company.countryCode);
  const merge = (x: ExtractedContacts) => {
    for (const e of x.emails) if (!result.emails.some((y) => y.value === e.value)) result.emails.push(e);
    for (const p of x.phones) if (!result.phones.some((y) => y.value === p.value)) result.phones.push(p);
    for (const f of x.forms) if (!result.forms.includes(f)) result.forms.push(f);
    for (const p of x.people) if (!result.people.some((y) => y.name === p.name)) result.people.push(p);
  };
  merge(first);
  for (const link of first.links.slice(0, Math.max(0, maxPages - 1))) {
    const page = await fetchPublicPage(link, { cache });
    if ("error" in page) continue;
    result.pagesChecked.push(page.url);
    identity = identity === "REGISTRATION_NUMBER" ? identity : (identityEvidence(page.html, company) ?? identity);
    merge(extractFromPage(page.html, page.url, company.countryCode));
  }
  result.identity = identity;
  return result;
}

/** Plausible own-domain candidates from the legal name (verified before use). */
const LEGAL_SUFFIX = /\b(as|asa|enk|nuf|da|ans|sa|ab|hb|kb|aps|a\/s|ivs|i\/s|oy|oyj|tmi|ky|gmbh|ug|ag|kg|ohg|sas|sasu|sarl|eurl|sci|ltd|limited|llp|plc|cic|bv|nv|vof|ou|oü|as|inc|incorporated|llc|pllc|lllp|lp|corp|corporation|co|company|pty|proprietary|ulc|ltee|ltée|kk)\.?$/i;
/** Country-specific legal forms that the single-word suffix rule cannot catch. */
const LEGAL_FORM_AFFIX: Record<string, RegExp[]> = {
  // Multi-part forms split into letters: "s.r.o.", "spol. s r.o.", "a.s.", "v.o.s.", "k.s.", "z.s.".
  CZ: [/[,\s]+(spol\.\s*s\s*r\.\s*o\.?|s\.\s?r\.\s?o\.?|a\.\s?s\.?|v\.\s?o\.\s?s\.?|k\.\s?s\.?|z\.\s?s\.?|z\.\s?ú\.?)\s*$/i],
  // The legal form comes first: SIA "Vastium", AS "…", IK "…".
  LV: [/^\s*(sia|as|ik|ks|ps|zs)\s+/i],
  CH: [/[,\s]+(gmbh|ag|sa|sàrl|sarl|sagl|genossenschaft|société coopérative|in liquidation)\.?\s*$/i],
  // "sp. z o.o.", "S.A.", "sp.k.", "sp.j." (spółka …)
  PL: [/[,\s]+(sp\.?\s*z\s*o\.?\s*o\.?|s\.?\s?a\.?|sp\.?\s?[kjp]\.?|spółka\s+(z\s+ograniczoną\s+odpowiedzialnością|akcyjna|komandytowa|jawna|cywilna))\s*$/i],
  // Japanese corporate designations in romanised names.
  JP: [/^\s*(kabushiki\s+kaisha|godo\s+kaisha)\s+|[,\s]+(kabushiki\s+kaisha|godo\s+kaisha|co\.?,?\s*ltd\.?)\s*$/i],
};

export function domainCandidates(name: string, countryCode: string) {
  const stripped = (LEGAL_FORM_AFFIX[countryCode] ?? []).reduce((n, rx) => n.replace(rx, " "), name).replace(/["“”„«»]/g, " ");
  const base = stripped
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/[øö]/g, "o")
    .replace(/[åäà]/g, "a")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .trim();
  let words = base.split(/[^a-z0-9]+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIX.test(words[words.length - 1]!)) words = words.slice(0, -1);
  if (!words.length) return [];
  const joined = words.join("");
  const hyphen = words.join("-");
  const out = new Set<string>();
  for (const tld of TLDS[countryCode] ?? []) {
    if (joined.length >= 3 && joined.length <= 40) out.add(`${joined}.${tld}`);
    if (words.length > 1 && hyphen.length <= 40) out.add(`${hyphen}.${tld}`);
  }
  return [...out].slice(0, 3);
}
