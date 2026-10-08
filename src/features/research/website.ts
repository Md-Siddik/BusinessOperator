import "server-only";
import { cleanEmail, cleanPhone, cleanWebsite } from "@/features/registry/normalize-helpers";
import { fetchPublicPage } from "@/features/intelligence/safe-fetch";
import { isWebmail } from "@/lib/company-fields";

/**
 * Official-website research. Treats every page as untrusted data: only
 * contact values are extracted (no instructions are followed, nothing is executed).
 * Polite: robots.txt, public hosts only, size + time limits, bounded page count.
 */

const CONTACT_PATH = /(contact|kontakt|kontakta|yhteys|ota-yhteytta|contacto|contatti|contato|impressum|imprint|legal|mentions-legales|mentions|about|om-oss|om_oss|omoss|tietoa|uber-uns|ueber-uns|team|tiimi|people)/i;
const CONTACT_LABEL = /(contact|kontakt|yhteys|impressum|imprint|legal notice|mentions|about|om oss|tietoa meistä|über uns|team)/i;

export const TLDS: Record<string, string[]> = { NO: ["no"], SE: ["se"], DK: ["dk"], FI: ["fi"], DE: ["de"], FR: ["fr"], GB: ["co.uk", "uk"], IE: ["ie"], NL: ["nl"], EE: ["ee"] };

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
  const text = textOf(html).toLowerCase();
  if (company.registrationNumber) {
    const reg = company.registrationNumber.replace(/[\s.-]/g, "").toLowerCase();
    if (reg.length >= 6 && text.replace(/[\s.-]/g, "").includes(reg)) return "REGISTRATION_NUMBER";
  }
  const name = company.companyName.toLowerCase().replace(/\s+/g, " ").trim();
  if (name.length >= 6 && text.includes(name)) return "EXACT_NAME";
  return null;
}

export type ExtractedContacts = {
  emails: { value: string; url: string; onOwnDomain: boolean; webmail: boolean }[];
  phones: { value: string; url: string; via: "tel-link" | "text" }[];
  forms: string[];
  links: string[];
};

export function extractFromPage(html: string, pageUrl: string, countryCode: string): ExtractedContacts {
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const out: ExtractedContacts = { emails: [], phones: [], forms: [], links: [] };
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
  const addPhone = (raw: string, via: "tel-link" | "text") => {
    const r = raw.trim();
    if (!/^(\+|00)/.test(r) && !localSite) return; // national formats only on sites in the company's country
    const p = cleanPhone(r, countryCode);
    if (!p || !/^\+\d{7,15}$/.test(p) || phoneSeen.has(p)) return;
    phoneSeen.add(p);
    out.phones.push({ value: p, url: pageUrl, via });
  };
  for (const m of html.matchAll(/href=["']tel:([^"']+)/gi)) addPhone(decodeURIComponent(m[1]!), "tel-link");
  for (const m of textOf(html).matchAll(/(?:tel|phone|telefon|puh|puhelin|tél|téléphone|mob|mobil|gsm|ring)\.?\s*[:.]?\s*(\+?\(?\d[\d\s().-]{6,18}\d)/gi)) addPhone(m[1]!.replace(/[()]/g, ""), "text");

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
};

/** Read the homepage and up to maxPages contact-type pages of one website. */
export async function researchWebsite(rawUrl: string, company: { companyName: string; registrationNumber?: string | null; countryCode: string }, maxPages = 5): Promise<WebsiteResearch> {
  const website = cleanWebsite(rawUrl) ?? rawUrl;
  const result: WebsiteResearch = { website, reachable: false, identity: null, pagesChecked: [], emails: [], phones: [], forms: [] };
  const home = await fetchPublicPage(website);
  if ("error" in home) return { ...result, error: home.error };
  result.reachable = true;
  result.pagesChecked.push(home.url);
  let identity = identityEvidence(home.html, company);
  const first = extractFromPage(home.html, home.url, company.countryCode);
  const merge = (x: ExtractedContacts) => {
    for (const e of x.emails) if (!result.emails.some((y) => y.value === e.value)) result.emails.push(e);
    for (const p of x.phones) if (!result.phones.some((y) => y.value === p.value)) result.phones.push(p);
    for (const f of x.forms) if (!result.forms.includes(f)) result.forms.push(f);
  };
  merge(first);
  for (const link of first.links.slice(0, Math.max(0, maxPages - 1))) {
    const page = await fetchPublicPage(link);
    if ("error" in page) continue;
    result.pagesChecked.push(page.url);
    identity = identity === "REGISTRATION_NUMBER" ? identity : (identityEvidence(page.html, company) ?? identity);
    merge(extractFromPage(page.html, page.url, company.countryCode));
  }
  result.identity = identity;
  return result;
}

/** Plausible own-domain candidates from the legal name (verified before use). */
const LEGAL_SUFFIX = /\b(as|asa|enk|nuf|da|ans|sa|ab|hb|kb|aps|a\/s|ivs|i\/s|oy|oyj|tmi|ky|gmbh|ug|ag|kg|ohg|sas|sasu|sarl|eurl|sci|ltd|limited|llp|plc|cic|bv|nv|vof|ou|oü|as)\.?$/i;
export function domainCandidates(name: string, countryCode: string) {
  const base = name
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
