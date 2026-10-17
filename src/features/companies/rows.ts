import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import type { ContactSourceKind, Relevance } from "@/lib/company-fields";
import type { CompanyDoc } from "@/models";
import type { CompanyRow } from "@/components/intel/types";

type Meta = { kind?: string | null; source?: string | null } | null | undefined;
const meta = (m: Meta) => (m?.kind ? { kind: m.kind as ContactSourceKind, source: m.source ?? undefined } : undefined);

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

export function toCompanyRow(c: CompanyDoc): CompanyRow {
  const flags: Partial<Record<"email" | "phone" | "mobile" | "website" | "address" | "person", boolean | null>> = c.contactFlags ?? {};
  return {
    id: String(c._id),
    href: `/dashboard/companies/${c.countryCode.toLowerCase()}/${String(c._id)}`,
    name: c.companyName,
    registrationNumber: c.registrationNumber ?? undefined,
    countryCode: c.countryCode,
    registrationDay: c.registrationDay ?? undefined,
    legalForm: c.legalForm ?? undefined,
    status: c.status ?? undefined,
    industryLabel: c.industryDescription ?? INDUSTRY_LABELS[(c.industry ?? "other") as IndustryKey],
    industryCode: c.industryCode ?? undefined,
    industryDescription: c.industryDescription ?? undefined,
    businessActivity: c.businessActivity ?? undefined,
    address: c.address ?? undefined,
    city: c.city ?? undefined,
    region: c.region ?? undefined,
    postalCode: c.postalCode ?? undefined,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    mobile: c.mobile ?? undefined,
    website: c.website ?? undefined,
    contactPerson: c.contactPerson?.name ? { name: c.contactPerson.name, role: c.contactPerson.role ?? undefined } : undefined,
    sources: {
      email: meta(c.contactSources?.email),
      phone: meta(c.contactSources?.phone),
      mobile: meta(c.contactSources?.mobile),
      website: meta(c.contactSources?.website),
      contactPerson: meta(c.contactSources?.contactPerson),
    },
    completeness: c.completeness ?? 0,
    flags: { email: !!flags.email, phone: !!flags.phone, mobile: !!flags.mobile, website: !!flags.website, address: !!flags.address, person: !!flags.person },
    fullyContactable: !!c.fullyContactable,
    marketingProtected: !!c.marketingProtected,
    score: c.lead?.score ?? 0,
    stage: c.lead?.stage ?? "NEW",
    lastContactedAt: iso(c.lead?.lastContactedAt),
    relevance: (c.lead?.relevance as Relevance | undefined) ?? undefined,
    saved: !!c.lead?.saved,
    isDemo: !!c.isDemo,
    sourceName: c.sourceName ?? undefined,
    sourceUrl: c.sourceUrl ?? undefined,
    freshness: c.dataFreshness ?? undefined,
    fetchedAt: c.sourceFetchedAt ? new Date(c.sourceFetchedAt).toISOString() : undefined,
    enrichedAt: c.enrichment?.lastRunAt ? new Date(c.enrichment.lastRunAt).toISOString() : undefined,
    registrationDateType: c.registrationDateType ?? undefined,
    eventType: c.eventType ?? undefined,
    firstSeenAt: iso(c.firstSeenAt),
    contactFoundAt: iso(c.contactFoundAt),
    sourcePublishedAt: iso(c.sourcePublishedAt),
    contactFormUrl: c.contactFormUrl ?? undefined,
    direct: {
      has: !!c.directContact?.has,
      hasEmail: !!c.directContact?.hasEmail,
      hasPhone: !!c.directContact?.hasPhone,
      quality: c.directContact?.quality ?? 0,
      pendingVerification: !!c.directContact?.pendingVerification,
      formOnly: !!c.directContact?.formOnly,
      emailVerification: c.directContact?.emailVerification ?? undefined,
      phoneVerification: c.directContact?.phoneVerification ?? undefined,
    },
    research: { status: c.research?.status ?? "NOT_STARTED", nextRetryAt: iso(c.research?.nextRetryAt), attempts: c.research?.attempts ?? 0 },
    eligibility: c.eligibility?.status ?? "NEEDS_REVIEW",
    fitScore: c.serviceFit?.score ?? 0,
    suggestedService: (c.serviceFit?.suggestions ?? []).find((x) => x.status === "ACCEPTED")?.packageName ?? (c.serviceFit?.suggestions ?? []).find((x) => x.status !== "REJECTED")?.packageName ?? undefined,
  };
}
