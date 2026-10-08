import "server-only";
import { Types } from "mongoose";
import { z } from "zod";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { Company, ServicePackage, WebsiteAudit, type CompanyDoc, type ServicePackageDoc, type WebsiteAuditDoc } from "@/models";
import { EVIDENCE_REQUIREMENTS } from "@/models/ServicePackage";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { isWebmail } from "@/lib/company-fields";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { addInboxItem } from "@/features/research/inbox";
import { getSetting } from "@/features/settings/service";

/**
 * Service-fit assessment — kept separate from registration confidence and contact quality.
 *
 * Only evidence-backed observations are used. "Website not found" means the
 * research did not find one — never proof the company has none. Nothing about
 * SEO quality, CRM, security or hiring is inferred without matching evidence.
 * Suggestions are proposals: the owner accepts, rejects or edits each.
 */

type PackageRules = { countries?: string[]; languages?: string[]; industries?: string[]; maxCompanyAgeDays?: number | null; requireDirectContact?: boolean; requiresEvidence?: string; weight?: number };
type PackageSeed = { key: string; name: string; group: string; description: string; deliverables: string[]; timeline: string; currency: string; lineItems: { description: string; quantity: number; unitPrice?: number; unit?: string }[]; active: boolean; rules: PackageRules; nextQuestion: string };

/** Grouped positioning from the handoff — owner-editable, prices empty (placeholders) until approved. */
export const DEFAULT_PACKAGES: PackageSeed[] = [
  {
    key: "digital-foundation",
    name: "Digital Foundation",
    group: "Digital Foundation",
    description: "Website, domain, business email and a Google Business Profile for a new company.",
    deliverables: ["Business website (up to 5 pages)", "Domain + business email setup", "Google Business Profile"],
    timeline: "2–4 weeks",
    currency: "EUR",
    lineItems: [{ description: "Business website setup", quantity: 1, unit: "project" }, { description: "Domain & business email setup", quantity: 1, unit: "project" }],
    active: true,
    rules: { countries: [], languages: [], industries: [], maxCompanyAgeDays: 120, requireDirectContact: false, requiresEvidence: "website_not_found_after_research", weight: 70 },
    nextQuestion: "Does the company already have a website or domain that research has not found?",
  },
  {
    key: "business-email-hosting",
    name: "Business email & hosting",
    group: "Digital Foundation",
    description: "Move from a public webmail address to a professional domain mailbox.",
    deliverables: ["Domain registration or transfer", "Business mailboxes", "DNS / deliverability setup"],
    timeline: "1 week",
    currency: "EUR",
    lineItems: [{ description: "Business email setup", quantity: 1, unit: "project" }],
    active: true,
    rules: { countries: [], languages: [], industries: [], requireDirectContact: true, requiresEvidence: "webmail_email", weight: 55 },
    nextQuestion: "Is the published webmail address their main business inbox?",
  },
  {
    key: "ongoing-digital-operations",
    name: "Ongoing Digital Operations",
    group: "Ongoing Digital Operations",
    description: "Website maintenance, updates, hosting and technical support.",
    deliverables: ["Monthly maintenance", "Content updates", "Technical support"],
    timeline: "Monthly",
    currency: "EUR",
    lineItems: [{ description: "Digital operations retainer", quantity: 1, unit: "month" }],
    active: true,
    rules: { countries: [], languages: [], industries: [], requireDirectContact: false, requiresEvidence: "website_found", weight: 40 },
    nextQuestion: "Who maintains the website today?",
  },
  {
    key: "growth-visibility",
    name: "Growth & Visibility (SEO)",
    group: "Growth & Visibility",
    description: "SEO basics, local visibility and performance fixes.",
    deliverables: ["Technical SEO fixes", "Local SEO", "Performance review"],
    timeline: "4–6 weeks",
    currency: "EUR",
    lineItems: [{ description: "SEO & visibility package", quantity: 1, unit: "project" }],
    active: true,
    rules: { countries: [], languages: [], industries: [], requireDirectContact: false, requiresEvidence: "weak_website_audit", weight: 60 },
    nextQuestion: "Which audit findings matter most to them?",
  },
  {
    key: "ecommerce",
    name: "E-commerce setup",
    group: "Digital Foundation",
    description: "Online shop setup for retail and e-commerce businesses.",
    deliverables: ["Shop setup", "Payment & shipping configuration", "Product import"],
    timeline: "4–8 weeks",
    currency: "EUR",
    lineItems: [{ description: "E-commerce setup", quantity: 1, unit: "project" }],
    active: true,
    rules: { countries: [], languages: [], industries: ["ecommerce", "retail"], requireDirectContact: false, requiresEvidence: "none", weight: 45 },
    nextQuestion: "Do they sell online already, or plan to?",
  },
  {
    key: "automation-systems",
    name: "Automation & Systems",
    group: "Automation & Systems",
    description: "CRM, inventory, reporting and process automation.",
    deliverables: ["Process review", "CRM / inventory setup", "Reporting"],
    timeline: "4–10 weeks",
    currency: "EUR",
    lineItems: [{ description: "Systems & automation project", quantity: 1, unit: "project" }],
    active: true,
    rules: { countries: [], languages: [], industries: ["logistics", "manufacturing", "construction", "retail"], requireDirectContact: false, requiresEvidence: "none", weight: 35 },
    nextQuestion: "Which systems do they use today for orders, stock and customers?",
  },
  {
    key: "people-recruitment",
    name: "People & Recruitment Support",
    group: "People/Recruitment Support",
    description: "Recruitment support for growing companies.",
    deliverables: ["Job ads", "Candidate screening support"],
    timeline: "Per role",
    currency: "EUR",
    lineItems: [{ description: "Recruitment support", quantity: 1, unit: "role" }],
    active: true,
    rules: { countries: [], languages: [], industries: [], requireDirectContact: false, requiresEvidence: "hiring_signal", weight: 65 },
    nextQuestion: "Which roles are they hiring for?",
  },
];

export async function ensureServicePackages() {
  for (const p of DEFAULT_PACKAGES) await ServicePackage.updateOne({ key: p.key }, { $setOnInsert: p }, { upsert: true });
}

type Evidence = { met: boolean; observation: string; source: string; confidence: "high" | "medium" | "low" };

function evaluateEvidence(req: string, c: CompanyDoc, audit: WebsiteAuditDoc | null): Evidence {
  const researched = (c.research?.attempts ?? 0) > 0;
  switch (req) {
    case "website_found":
      return c.website ? { met: true, observation: `Has a website (${c.website.replace(/^https?:\/\//, "")})`, source: c.contactSources?.website?.source ?? c.sourceName ?? "Registry", confidence: "medium" } : { met: false, observation: "", source: "", confidence: "low" };
    case "website_not_found_after_research":
      return !c.website && researched
        ? { met: true, observation: "No website found in the registry or in website research (not proof that none exists)", source: `Contact research (${c.research?.attempts} attempt(s))`, confidence: "medium" }
        : { met: false, observation: "", source: "", confidence: "low" };
    case "weak_website_audit":
      return audit && audit.score != null && audit.score < 50 ? { met: true, observation: `Website audit scored ${audit.score}/100: ${audit.issues.slice(0, 3).join("; ")}`, source: "ExploreTechify website audit", confidence: "high" } : { met: false, observation: "", source: "", confidence: "low" };
    case "hiring_signal":
      return c.signals?.hiring ? { met: true, observation: "Hiring signal recorded", source: c.signals.hiringSource ?? "Signal", confidence: "medium" } : { met: false, observation: "", source: "", confidence: "low" };
    case "direct_contact":
      return c.directContact?.has ? { met: true, observation: "Has a direct business contact", source: "Contact research", confidence: "medium" } : { met: false, observation: "", source: "", confidence: "low" };
    case "webmail_email":
      return c.email && isWebmail(c.email) ? { met: true, observation: `Published email uses a public webmail domain (${c.email.split("@")[1]})`, source: c.contactSources?.email?.source ?? "Contact research", confidence: "medium" } : { met: false, observation: "", source: "", confidence: "low" };
    default:
      return { met: true, observation: "", source: "", confidence: "low" };
  }
}

/** (Re)assess one company. Owner decisions on existing suggestions are preserved. */
export async function assessServiceFit(companyId: Types.ObjectId | string) {
  const c = await Company.findById(companyId).lean<CompanyDoc>();
  if (!c) return null;
  const [packages, latestAudit] = await Promise.all([ServicePackage.find({ active: true }).lean<ServicePackageDoc[]>(), WebsiteAudit.findOne({ companyId: c._id }).sort({ checkedAt: -1 }).lean<WebsiteAuditDoc>()]);
  const ageDays = c.registrationDay ? (Date.now() - Date.parse(`${c.registrationDay}T00:00:00Z`)) / 86_400_000 : undefined;
  const previous = new Map((c.serviceFit?.suggestions ?? []).map((s) => [String(s.packageId), s]));
  const suggestions = [];
  for (const p of packages) {
    const r = (p.rules ?? {}) as PackageRules;
    if (r.countries?.length && !r.countries.includes(c.countryCode)) continue;
    if (r.industries?.length && !r.industries.includes(c.industry ?? "other")) continue;
    if (r.maxCompanyAgeDays && ageDays !== undefined && ageDays > r.maxCompanyAgeDays) continue;
    if (r.requireDirectContact && !c.directContact?.has) continue;
    const ev = evaluateEvidence(r.requiresEvidence ?? "none", c, latestAudit);
    if (!ev.met) continue;
    const industryObs = r.industries?.length ? `Registered activity: ${c.industryDescription ?? INDUSTRY_LABELS[(c.industry ?? "other") as IndustryKey]}${c.industryCode ? ` (${c.industryCode})` : ""}` : "";
    const observation = [ev.observation, industryObs].filter(Boolean).join(" · ") || "Matches the package's targeting rules";
    const prev = previous.get(String(p._id));
    suggestions.push({
      packageId: p._id,
      packageName: p.name,
      observation,
      source: ev.source || (industryObs ? c.sourceName ?? "Registry" : "Targeting rules"),
      confidence: r.requiresEvidence === "none" ? "low" : ev.confidence,
      nextQuestion: p.nextQuestion,
      status: prev?.status ?? "SUGGESTED",
      note: prev?.note,
      decidedBy: prev?.decidedBy,
      decidedAt: prev?.decidedAt,
      weight: r.weight ?? 50,
    });
  }
  // Keep owner-decided suggestions even if the rule no longer matches.
  for (const [id, prev] of previous) if (prev.status !== "SUGGESTED" && !suggestions.some((s) => String(s.packageId) === id)) suggestions.push({ ...prev, weight: 0 });
  const active = suggestions.filter((s) => s.status !== "REJECTED");
  const score = active.length ? Math.min(100, Math.max(...active.map((s) => (s.weight ?? 0) * (s.confidence === "high" ? 1.2 : s.confidence === "medium" ? 1 : 0.7)))) : 0;
  await Company.updateOne({ _id: c._id }, { $set: { "serviceFit.score": Math.round(score), "serviceFit.assessedAt": new Date(), "serviceFit.suggestions": suggestions.map((x) => { const { weight, ...rest } = x; void weight; return rest; }) } });
  const settings = await getSetting("research");
  if (score >= settings.inbox.minServiceFitScore && c.directContact?.has) {
    await addInboxItem({ type: "SERVICE_MATCH", dedupeKey: `fit:${c._id}`, companyId: c._id, countryCode: c.countryCode, title: `${c.companyName}: strong service match (${Math.round(score)})`, body: active.map((s) => s.packageName).join(", "), priority: Math.round(score) });
  }
  return { score: Math.round(score), suggestions };
}

const decisionSchema = z.object({ packageId: z.string(), status: z.enum(["ACCEPTED", "REJECTED", "EDITED", "SUGGESTED"]), note: z.string().trim().max(1000).optional() });

export async function decideSuggestion(actor: Actor, companyId: string, input: unknown) {
  if (!can(actor, "companies.read")) throw Errors.forbidden();
  const d = decisionSchema.parse(input);
  const res = await Company.updateOne(
    { _id: parseObjectId(companyId), "serviceFit.suggestions.packageId": new Types.ObjectId(d.packageId) },
    { $set: { "serviceFit.suggestions.$.status": d.status, "serviceFit.suggestions.$.note": d.note, "serviceFit.suggestions.$.decidedBy": new Types.ObjectId(actor.id), "serviceFit.suggestions.$.decidedAt": new Date() } },
  );
  if (!res.matchedCount) throw Errors.notFound();
  await audit(actor, "servicefit.decided", { entityType: "Company", entityId: companyId, metadata: d });
  await assessServiceFit(companyId);
  return { ok: true };
}

export const packageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  group: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  deliverables: z.array(z.string().trim().max(200)).max(20).default([]),
  timeline: z.string().trim().max(100).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  lineItems: z.array(z.object({ description: z.string().trim().min(1).max(200), quantity: z.number().min(0).max(10_000).default(1), unitPrice: z.number().min(0).max(10_000_000).nullable().optional(), unit: z.string().trim().max(30).optional() })).max(20).default([]),
  terms: z.string().trim().max(3000).optional(),
  active: z.boolean().default(true),
  nextQuestion: z.string().trim().max(300).optional(),
  rules: z
    .object({
      countries: z.array(z.string().toUpperCase()).default([]),
      languages: z.array(z.string()).default([]),
      industries: z.array(z.string()).default([]),
      maxCompanyAgeDays: z.number().int().min(1).max(3650).nullable().optional(),
      requireDirectContact: z.boolean().default(false),
      requiresEvidence: z.enum(EVIDENCE_REQUIREMENTS).default("none"),
      weight: z.number().int().min(0).max(100).default(50),
    })
    .default({ countries: [], languages: [], industries: [], requireDirectContact: false, requiresEvidence: "none", weight: 50 }),
});

export async function listPackages() {
  await ensureServicePackages();
  return ServicePackage.find().sort({ group: 1, name: 1 }).lean<ServicePackageDoc[]>();
}

export async function savePackage(actor: Actor, id: string | null, input: unknown) {
  if (!can(actor, "settings.manage")) throw Errors.forbidden();
  const data = packageSchema.parse(input);
  const doc = id
    ? await ServicePackage.findByIdAndUpdate(parseObjectId(id), { $set: { ...data, updatedBy: actor.id } }, { new: true }).lean<ServicePackageDoc>()
    : (await ServicePackage.create({ ...data, key: `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`, updatedBy: actor.id })).toObject();
  if (!doc) throw Errors.notFound();
  await audit(actor, "servicepackage.saved", { entityType: "ServicePackage", entityId: String(doc._id), metadata: { name: data.name } });
  return doc;
}
