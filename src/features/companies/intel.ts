import "server-only";
import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { INDUSTRIES, INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { Company, Contact, type CompanyDoc, type ContactDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { companyTypeOf, COMPANY_TYPE_LABELS, type CompanyType } from "@/lib/company-classification";
import { CONTACT_STATUSES, CONTACT_SOURCE_LABELS, contactStatusOf, displayWebsite, EMAIL_VERIFICATION_LABELS, formatPhone, PHONE_VERIFICATION_LABELS, type ContactSourceKind, type ContactStatus } from "@/lib/company-fields";
import { escapeRegex } from "@/lib/utils";
import { safeExternalUrl } from "@/lib/utils/url";
import { parseObjectId } from "@/lib/validation";
import { assertCanReadCompanies, buildCompanyFilter, companyQuerySchema, listCompanies, type CompanySort } from "./service";

/**
 * Company Intelligence for team members (Owner-granted: companies.read / .edit / .export /
 * .delete). A read model on top of the shared company query: the same filters, sorting,
 * classification and contact status as the Owner workspace, but only company and public
 * business-contact data — never CRM state, notes, outreach, research cost or raw source data.
 */

export const DIRECTORY_SORTS = ["contact", "name", "registration", "type", "updated"] as const satisfies readonly CompanySort[];
export const DIRECTORY_SORT_LABELS: Record<(typeof DIRECTORY_SORTS)[number], string> = {
  contact: "Best contact first",
  name: "Company name",
  registration: "Newest registration",
  type: "Company type",
  updated: "Last updated",
};

export const directoryQuerySchema = z.object({
  country: z.string().min(2).default("ALL"),
  type: z.enum(["startup", "established", "review"]).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  email: z.enum(["yes", "no"]).optional(),
  phone: z.enum(["yes", "no"]).optional(),
  contactStatus: z.enum(CONTACT_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(DIRECTORY_SORTS).default("contact"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

/** Translate directory params into the shared company query (every registration date, every event type). */
export function toCompanyQueryInput(q: DirectoryQuery) {
  return {
    country: q.country,
    range: "all",
    events: "all",
    type: q.type,
    industry: q.industry,
    contact: [q.email === "yes" && "email", q.phone === "yes" && "phone"].filter(Boolean).join(",") || undefined,
    email: q.email === "no" ? "no" : undefined,
    phone: q.phone === "no" ? "no" : undefined,
    contactStatus: q.contactStatus,
    q: q.q,
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export type DirectoryRow = {
  id: string;
  name: string;
  countryCode: string;
  city?: string;
  industry: string;
  type: CompanyType;
  typeReason?: string;
  manualType: boolean;
  contactStatus: ContactStatus;
  email?: string;
  emailSource?: string;
  phone?: string;
  phoneDisplay?: string;
  website?: { href: string; display: string };
  contactPerson?: { name: string; role?: string };
  foundedDay?: string;
  employees?: number;
  sourceName?: string;
  updatedAt?: string;
  marketingProtected: boolean;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);
const withheld = (c: CompanyDoc) => c.eligibility?.status === "DO_NOT_CONTACT" || c.eligibility?.status === "RESTRICTED" || !!c.marketingProtected;

function statusOf(c: CompanyDoc) {
  return contactStatusOf({ direct: { has: !!c.directContact?.has, emailVerification: c.directContact?.emailVerification, phoneVerification: c.directContact?.phoneVerification, pendingVerification: !!c.directContact?.pendingVerification }, research: { status: c.research?.status, attempts: c.research?.attempts } });
}

export function toDirectoryRow(c: CompanyDoc): DirectoryRow {
  const hold = withheld(c);
  const phone = hold ? undefined : (c.phone ?? c.mobile ?? undefined);
  return {
    id: String(c._id),
    name: c.companyName,
    countryCode: c.countryCode,
    city: c.city ?? c.region ?? undefined,
    industry: c.industryDescription ?? INDUSTRY_LABELS[(c.industry ?? "other") as IndustryKey],
    type: companyTypeOf(c.companyType),
    typeReason: c.companyType?.reason ?? undefined,
    manualType: !!c.companyType?.manual,
    contactStatus: statusOf(c),
    email: hold ? undefined : (c.email ?? undefined),
    emailSource: c.contactSources?.email?.kind ? CONTACT_SOURCE_LABELS[c.contactSources.email.kind as ContactSourceKind] : undefined,
    phone,
    phoneDisplay: phone ? formatPhone(phone) : undefined,
    website: safeExternalUrl(c.website) ?? undefined,
    contactPerson: c.contactPerson?.name ? { name: c.contactPerson.name, role: c.contactPerson.role ?? undefined } : undefined,
    foundedDay: iso(c.incorporationDate)?.slice(0, 10) ?? c.registrationDay ?? undefined,
    employees: c.employees ?? undefined,
    sourceName: c.sourceName ?? undefined,
    updatedAt: iso(c.updatedAt),
    marketingProtected: hold,
  };
}

/** One page of the directory plus the per-type counts for the category tabs and the summary cards. */
export async function listDirectory(actor: Actor, input: unknown) {
  assertCanReadCompanies(actor);
  const q = directoryQuerySchema.parse(input);
  const companyInput = toCompanyQueryInput(q);
  const list = await listCompanies(actor, companyInput);
  const base = buildCompanyFilter(actor, companyQuerySchema.parse({ ...companyInput, type: undefined }));
  const filtered = buildCompanyFilter(actor, companyQuerySchema.parse(companyInput));
  const [byType, stats] = await Promise.all([
    Company.aggregate<{ _id: string | null; n: number }>([{ $match: base }, { $group: { _id: "$companyType.value", n: { $sum: 1 } } }]),
    Company.aggregate<{ total: number; email: number; phone: number; verified: number }>([
      { $match: filtered },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          email: { $sum: { $cond: ["$directContact.hasEmail", 1, 0] } },
          phone: { $sum: { $cond: ["$directContact.hasPhone", 1, 0] } },
          verified: { $sum: { $cond: [{ $or: [{ $eq: ["$directContact.emailVerification", "DELIVERABLE"] }, { $eq: ["$directContact.phoneVerification", "REACHABILITY_CONFIRMED"] }] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const counts = { all: 0, startup: 0, established: 0, review: 0 };
  for (const r of byType) {
    counts.all += r.n;
    if (r._id === "STARTUP") counts.startup += r.n;
    else if (r._id === "ESTABLISHED") counts.established += r.n;
    else counts.review += r.n;
  }
  return {
    ...list,
    items: list.items.map(toDirectoryRow),
    counts,
    stats: { total: stats[0]?.total ?? 0, withEmail: stats[0]?.email ?? 0, withPhone: stats[0]?.phone ?? 0, verified: stats[0]?.verified ?? 0 },
    query: q,
    abilities: { edit: can(actor, "companies.edit"), export: can(actor, "companies.export"), delete: can(actor, "companies.delete") },
  };
}

export type DirectoryPage = Awaited<ReturnType<typeof listDirectory>>;

/* ───────────────────────── Detail ───────────────────────── */

export type IntelContact = {
  value: string;
  display: string;
  kind: "Business inbox" | "Named person" | "Phone" | "Mobile";
  personName?: string;
  role?: string;
  verification?: string;
  source: string;
  sourceKind: string;
  sourceUrl?: string;
  lastSeen?: string;
  needsReview: boolean;
};

const CONTACT_FIELDS = "type value personName role sourceKind source sourceUrl emailVerification phoneVerification usable ownership review collectedAt lastSeenAt verifiedAt";

/**
 * Everything a marketer needs about one company — with the evidence for every contact value.
 * A generic inbox is never shown as a person's email: only an address the source publishes
 * together with a named person is labelled "Named person".
 */
export async function getIntelDetail(actor: Actor, id: string) {
  assertCanReadCompanies(actor);
  const c = await Company.findById(parseObjectId(id)).lean<CompanyDoc>();
  if (!c) throw Errors.notFound("Company not found");
  const hold = withheld(c);
  const contacts = hold ? [] : await Contact.find({ companyId: c._id, type: { $in: ["EMAIL", "PHONE", "MOBILE"] }, usable: true, review: { $ne: "REJECTED" }, ownership: { $nin: ["INTERMEDIARY"] } }).select(CONTACT_FIELDS).sort({ type: 1, collectedAt: -1 }).limit(20).lean<ContactDoc[]>();
  const toContact = (k: ContactDoc): IntelContact => {
    const isEmail = k.type === "EMAIL";
    return {
      value: k.value,
      display: isEmail ? k.value : formatPhone(k.value),
      kind: isEmail ? (k.personName ? "Named person" : "Business inbox") : k.type === "MOBILE" ? "Mobile" : "Phone",
      personName: k.personName ?? undefined,
      role: k.role ?? undefined,
      verification: isEmail ? (k.emailVerification ? EMAIL_VERIFICATION_LABELS[k.emailVerification as keyof typeof EMAIL_VERIFICATION_LABELS] : undefined) : k.phoneVerification ? PHONE_VERIFICATION_LABELS[k.phoneVerification as keyof typeof PHONE_VERIFICATION_LABELS] : undefined,
      source: k.source,
      sourceKind: CONTACT_SOURCE_LABELS[k.sourceKind as ContactSourceKind] ?? k.sourceKind,
      sourceUrl: safeExternalUrl(k.sourceUrl)?.href,
      lastSeen: iso(k.lastSeenAt ?? k.verifiedAt ?? k.collectedAt),
      needsReview: k.review === "PENDING" || k.ownership === "UNCERTAIN",
    };
  };

  // Duplicate detection: other records sharing the registration number, website domain or phone.
  const or: FilterQuery<CompanyDoc>[] = [];
  const host = displayWebsite(c.website).split("/")[0];
  if (host) or.push({ website: new RegExp(`^https?://(www\\.)?${escapeRegex(host)}(/|$)`, "i") });
  if (c.phone) or.push({ phone: c.phone });
  if (c.registrationNumber) or.push({ registrationNumber: c.registrationNumber, countryCode: { $ne: c.countryCode } });
  const duplicates = or.length ? await Company.find({ _id: { $ne: c._id }, $or: or }).select("companyName countryCode website phone registrationNumber").limit(5).lean<CompanyDoc[]>() : [];

  const row = toDirectoryRow(c);
  return {
    ...row,
    typeLabel: COMPANY_TYPE_LABELS[row.type],
    typeBasis: c.companyType?.basis ?? [],
    registrationNumber: c.registrationNumber ?? undefined,
    legalForm: c.legalForm ?? undefined,
    status: c.status ?? undefined,
    address: [c.address, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || undefined,
    region: c.region ?? undefined,
    description: c.businessActivity ?? c.companyPurpose ?? undefined,
    industryCode: c.industryCode ?? undefined,
    socialLinks: (c.socialLinks ?? []).map((s) => ({ network: s.network ?? "Profile", link: safeExternalUrl(s.url) })).filter((s) => s.link),
    emails: contacts.filter((k) => k.type === "EMAIL").map(toContact),
    phones: contacts.filter((k) => k.type !== "EMAIL").map(toContact),
    withheldReason: hold ? (c.marketingProtected ? "The registry marks this company as protected from marketing." : "Marked restricted / do not contact.") : undefined,
    sourceUrl: safeExternalUrl(c.sourceUrl)?.href,
    sourceFetchedAt: iso(c.sourceFetchedAt),
    contactLastVerifiedAt: iso(c.contactLastVerifiedAt),
    researchStatus: c.research?.status ?? "NOT_STARTED",
    discoveredVia: c.discoveredVia ?? "NEW_REGISTRATIONS",
    duplicates: duplicates.map((d) => ({ id: String(d._id), name: d.companyName, countryCode: d.countryCode, reason: d.registrationNumber && d.registrationNumber === c.registrationNumber ? "Same registration number" : d.phone && d.phone === c.phone ? "Same phone number" : "Same website" })),
  };
}
export type IntelDetail = Awaited<ReturnType<typeof getIntelDetail>>;

/* ───────────────────────── Actions ───────────────────────── */

/** Queue a fresh contact research run (companies.edit). Never runs paid providers beyond the Owner's budget. */
export async function requestContactRefresh(actor: Actor, id: string) {
  if (!can(actor, "companies.edit")) throw Errors.forbidden();
  const c = await Company.findById(parseObjectId(id)).select("countryCode registrationDay isDemo").lean<CompanyDoc>();
  if (!c) throw Errors.notFound("Company not found");
  if (c.isDemo) throw Errors.badRequest("Demo companies aren't researched.");
  const { enqueueResearch } = await import("@/features/research/engine");
  await enqueueResearch(String(c._id), { reason: "manual", registrationDay: c.registrationDay });
  await audit(actor, "company.contact_refresh_requested", { entityType: "Company", entityId: id, countryCode: c.countryCode });
  return { queued: true };
}

export async function deleteIntelCompany(actor: Actor, id: string) {
  if (!can(actor, "companies.delete")) throw Errors.forbidden();
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound();
  const { deleteCompany } = await import("./service");
  await deleteCompany(actor, id, { suppress: true });
  return { deleted: true };
}
