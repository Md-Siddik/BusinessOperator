import type { ContactSourceKind, Relevance } from "@/lib/company-fields";

/** Serializable company row for the daily list, drawer and cards (no raw source data). */
export type CompanyRow = {
  id: string;
  href: string;
  name: string;
  registrationNumber?: string;
  countryCode: string;
  registrationDay?: string;
  legalForm?: string;
  status?: string;
  industryLabel: string;
  industryCode?: string;
  industryDescription?: string;
  businessActivity?: string;
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  contactPerson?: { name: string; role?: string };
  sources: Partial<Record<"email" | "phone" | "mobile" | "website" | "contactPerson", { kind?: ContactSourceKind; source?: string }>>;
  completeness: number;
  flags: { email: boolean; phone: boolean; mobile: boolean; website: boolean; address: boolean; person: boolean };
  fullyContactable: boolean;
  marketingProtected: boolean;
  score: number;
  stage: string;
  relevance?: Relevance;
  saved: boolean;
  isDemo: boolean;
  sourceName?: string;
  sourceUrl?: string;
  freshness?: string;
  fetchedAt?: string;
  enrichedAt?: string;
  registrationDateType?: string;
  eventType?: string;
  firstSeenAt?: string;
  contactFoundAt?: string;
  sourcePublishedAt?: string;
  contactFormUrl?: string;
  direct: { has: boolean; hasEmail: boolean; hasPhone: boolean; quality: number; pendingVerification: boolean; formOnly: boolean; emailVerification?: string; phoneVerification?: string };
  research: { status: string; nextRetryAt?: string; attempts: number };
  eligibility: string;
  fitScore: number;
  suggestedService?: string;
};

/** What the registry for this row's country can provide — drives "not available" wording. */
export type SourceCapabilities = { email: boolean; phone: boolean; mobile: boolean; website: boolean; person: boolean };
