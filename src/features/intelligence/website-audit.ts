import { Company, WebsiteAudit, type CompanyDoc } from "@/models";
import { audit as auditLog } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { rescoreCompanies } from "@/features/companies/service";
import { siteConfig } from "@/config/site";

const USER_AGENT = `${siteConfig.name}-SiteCheck/1.0 (+${siteConfig.url})`;
const MAX_BYTES = 2_000_000;

export type AuditResult = {
  url: string;
  finalUrl?: string;
  ok: boolean;
  error?: string;
  robotsAllowed?: boolean;
  statusCode?: number;
  https?: boolean;
  mobileFriendly?: boolean;
  title?: string;
  metaDescription?: string;
  hasOpenGraph?: boolean;
  h1Count?: number;
  socialLinks: string[];
  hasContactInfo?: boolean;
  contactEmails: string[];
  technologies: string[];
  responseTimeMs?: number;
  pageSizeKb?: number;
  brokenLinks: string[];
  linksChecked?: number;
  score?: number;
  issues: string[];
};

/** Minimal robots.txt check for our user agent and "*" (Disallow prefixes only). */
async function isAllowedByRobots(url: URL) {
  try {
    const res = await fetch(`${url.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true;
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.split("#")[0]!.trim());
    let applies = false;
    const disallow: string[] = [];
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || USER_AGENT.toLowerCase().includes(value.toLowerCase());
      else if (applies && key === "disallow" && value) disallow.push(value);
    }
    return !disallow.some((p) => url.pathname.startsWith(p));
  } catch {
    return true;
  }
}

async function readLimited(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8");
}

const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.trim();

function detectTechnologies(html: string, headers: Headers) {
  const tech = new Set<string>();
  const h = html.toLowerCase();
  if (h.includes("wp-content") || h.includes("wordpress")) tech.add("WordPress");
  if (h.includes("cdn.shopify.com")) tech.add("Shopify");
  if (h.includes("wix.com") || h.includes("wixstatic")) tech.add("Wix");
  if (h.includes("squarespace")) tech.add("Squarespace");
  if (h.includes("webflow")) tech.add("Webflow");
  if (h.includes("__next") || h.includes("_next/static")) tech.add("Next.js");
  if (h.includes("googletagmanager.com") || h.includes("gtag(")) tech.add("Google Analytics / Tag Manager");
  if (h.includes("woocommerce")) tech.add("WooCommerce");
  const server = headers.get("server");
  if (server) tech.add(`Server: ${server.split(" ")[0]}`);
  return [...tech];
}

/** Real HTTP audit of a single homepage. Polite: robots.txt respected, one page + a few HEAD link checks. */
export async function auditWebsite(rawUrl: string): Promise<AuditResult> {
  const result: AuditResult = { url: rawUrl, ok: false, socialLinks: [], contactEmails: [], technologies: [], brokenLinks: [], issues: [] };
  let url: URL;
  try {
    url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ...result, error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || url.hostname.endsWith(".local")) {
    return { ...result, error: "This address cannot be audited." };
  }
  result.robotsAllowed = await isAllowedByRobots(url);
  if (!result.robotsAllowed) return { ...result, error: "robots.txt disallows automated access — audit skipped." };

  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    result.statusCode = res.status;
    result.finalUrl = res.url;
    result.responseTimeMs = Date.now() - started;
    const html = await readLimited(res);
    result.pageSizeKb = Math.round(Buffer.byteLength(html) / 1024);
    result.ok = res.ok;
    result.https = new URL(res.url).protocol === "https:";
    result.mobileFriendly = /<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html);
    result.title = attr(html, /<title[^>]*>([^<]{0,300})<\/title>/i);
    result.metaDescription = attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i) ?? attr(html, /<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i);
    result.hasOpenGraph = /<meta[^>]+property=["']og:/i.test(html);
    result.h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    result.socialLinks = [...new Set((html.match(/https?:\/\/(www\.)?(linkedin|facebook|instagram|x|twitter|youtube|tiktok)\.com\/[^"'\s<>)]+/gi) ?? []).slice(0, 10))];
    result.contactEmails = [...new Set((html.match(/mailto:([^"'?\s>]+)/gi) ?? []).map((m) => m.slice(7).toLowerCase()))].slice(0, 5);
    result.hasContactInfo = result.contactEmails.length > 0 || /tel:/i.test(html) || /contact|kontakt|yhteystiedot/i.test(html);
    result.technologies = detectTechnologies(html, res.headers);

    // Check a handful of same-site links (HEAD) — broken-link indicator without crawling.
    const links = [...new Set((html.match(/href=["'](\/[^"'#?]{1,200})["']/gi) ?? []).map((h) => h.slice(6, -1)))].slice(0, 8);
    result.linksChecked = links.length;
    for (const link of links) {
      try {
        const r = await fetch(new URL(link, res.url), { method: "HEAD", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(5000), redirect: "follow" });
        if (r.status >= 400 && r.status !== 405) result.brokenLinks.push(link);
      } catch {
        result.brokenLinks.push(link);
      }
    }
  } catch (err) {
    return { ...result, error: err instanceof Error && err.name === "TimeoutError" ? "The website did not respond in time." : "The website could not be reached." };
  }
  return scoreAudit(result);
}

export function scoreAudit(r: AuditResult): AuditResult {
  let score = 100;
  const issues: string[] = [];
  const penalty = (cond: boolean | undefined, points: number, issue: string) => {
    if (cond) {
      score -= points;
      issues.push(issue);
    }
  };
  penalty(!r.ok, 40, "Homepage did not load successfully");
  penalty(r.https === false, 20, "No HTTPS");
  penalty(r.mobileFriendly === false, 15, "Not mobile-friendly (no responsive viewport)");
  penalty(!r.title, 10, "Missing page title");
  penalty(!r.metaDescription, 10, "Missing meta description");
  penalty(r.h1Count === 0, 5, "No H1 heading");
  penalty(!r.hasOpenGraph, 5, "No Open Graph tags for social sharing");
  penalty(r.hasContactInfo === false, 5, "No visible contact information");
  penalty((r.responseTimeMs ?? 0) > 3000, 10, "Slow response (> 3 s)");
  penalty((r.pageSizeKb ?? 0) > 1500, 5, "Large HTML page (> 1.5 MB)");
  penalty(r.brokenLinks.length > 0, 10, `${r.brokenLinks.length} broken internal link(s)`);
  return { ...r, score: Math.max(0, score), issues };
}

/** Deterministic, clearly-labelled demo audit for demo companies (".example" domains are never fetched). */
function demoAudit(company: CompanyDoc): AuditResult {
  const seed = [...String(company._id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const flag = (n: number) => (seed >> n) % 3 !== 0;
  return scoreAudit({
    url: company.website!,
    finalUrl: company.website!,
    ok: true,
    robotsAllowed: true,
    statusCode: 200,
    https: flag(1),
    mobileFriendly: flag(2),
    title: company.companyName,
    metaDescription: flag(3) ? `${company.companyName} — ${company.industryDescription ?? ""}` : undefined,
    hasOpenGraph: flag(4),
    h1Count: flag(5) ? 1 : 0,
    socialLinks: (company.socialLinks ?? []).map((s) => s.url).filter((u): u is string => !!u),
    hasContactInfo: flag(6),
    contactEmails: company.email ? [company.email] : [],
    technologies: [["WordPress", "Wix", "Squarespace", "Shopify", "Custom"][seed % 5]!],
    responseTimeMs: 300 + (seed % 3500),
    pageSizeKb: 80 + (seed % 900),
    brokenLinks: seed % 4 === 0 ? ["/old-page"] : [],
    linksChecked: 6,
    issues: [],
  });
}

export async function runWebsiteAudit(actor: Actor, companyId: string) {
  if (!can(actor, "companies.read")) throw Errors.forbidden();
  const company = await Company.findById(parseObjectId(companyId)).lean<CompanyDoc>();
  if (!company) throw Errors.notFound();
  if (!company.website) throw Errors.badRequest("This company has no website to audit.");
  const result = company.isDemo ? demoAudit(company) : await auditWebsite(company.website);
  const doc = await WebsiteAudit.create({ ...result, companyId: company._id, isDemo: company.isDemo, checkedBy: actor.id, checkedAt: new Date() });
  if (result.score != null) {
    await Company.updateOne(
      { _id: company._id },
      { $set: { auditSummary: { score: result.score, checkedAt: new Date(), https: result.https, mobileFriendly: result.mobileFriendly, hasMetaDescription: !!result.metaDescription } } },
    );
    await rescoreCompanies({ _id: company._id });
  }
  await auditLog(actor, "company.website_audited", { entityType: "Company", entityId: companyId, countryCode: company.countryCode, metadata: { score: result.score, error: result.error } });
  return doc.toObject();
}
