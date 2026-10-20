/**
 * Focused service LANDING PAGES (/services/<slug>): one problem, one solution, one offer.
 * Structure only — every visible text lives in messages/*.json under "servicePages.<key>"
 * (editable per language in Settings → Languages). Add a service: add an entry here and
 * its "servicePages.<key>" block in every dictionary.
 *
 * PRICING / DELIVERY: no prices or delivery times have been approved yet, so every
 * `amountNok` and `deliveryWeeks` is null and the page says the price and timeline are
 * agreed in a written offer. To publish a price, set a number here, e.g.
 *   pricing: { kind: "fixed", amountNok: 15000 }   → "Fixed price: NOK 15 000"
 *   deliveryWeeks: { min: 2, max: 4 }              → "Typical delivery: 2–4 weeks"
 * Never put an unapproved number here.
 */
export type PricingKind = "fixed" | "from" | "monthly" | "quote";

export type ServicePage = {
  slug: string;
  key: string;
  icon: string;
  /** Case-study service keys (serviceItems.*) that count as examples for this page. */
  portfolio: string[];
  /** Related landing pages, shown at the bottom (keep it to 2–3). */
  related: string[];
  pricing: { kind: PricingKind; amountNok: number | null };
  deliveryWeeks: { min: number; max: number } | null;
  /** Preselects "What do you need?" in the contact form. */
  contactNeed: "website" | "ongoing" | "systems" | "growth" | "recruitment" | "automation" | "notSure";
};

export const SERVICE_PAGES: ServicePage[] = [
  { slug: "web-development", key: "webDevelopment", icon: "MonitorSmartphone", portfolio: ["businessWebsite", "ecommerce", "basicSeo"], related: ["seo", "web-crm", "visual-identity"], pricing: { kind: "fixed", amountNok: null }, deliveryWeeks: null, contactNeed: "website" },
  { slug: "web-crm", key: "webCrm", icon: "Network", portfolio: ["crm", "leadGenerationSystems", "crmAutomation"], related: ["web-development", "crm", "automation"], pricing: { kind: "from", amountNok: null }, deliveryWeeks: null, contactNeed: "systems" },
  { slug: "crm", key: "crm", icon: "Contact", portfolio: ["crm", "crmAutomation", "dataManagement"], related: ["web-crm", "automation", "data-collection"], pricing: { kind: "from", amountNok: null }, deliveryWeeks: null, contactNeed: "systems" },
  { slug: "seo", key: "seo", icon: "Search", portfolio: ["seo", "localSeo", "basicSeo", "seoSupport"], related: ["web-development", "social-media", "digital-operations"], pricing: { kind: "from", amountNok: null }, deliveryWeeks: null, contactNeed: "growth" },
  { slug: "visual-identity", key: "visualIdentity", icon: "Palette", portfolio: ["digitalAssetManagement", "businessWebsite"], related: ["web-development", "social-media"], pricing: { kind: "fixed", amountNok: null }, deliveryWeeks: null, contactNeed: "website" },
  { slug: "social-media", key: "socialMedia", icon: "Megaphone", portfolio: ["socialMediaSupport", "socialMediaSetup", "digitalMarketingSupport"], related: ["seo", "visual-identity", "digital-operations"], pricing: { kind: "monthly", amountNok: null }, deliveryWeeks: null, contactNeed: "growth" },
  { slug: "data-collection", key: "dataCollection", icon: "Database", portfolio: ["dataManagement", "reporting", "businessDashboards"], related: ["crm", "automation"], pricing: { kind: "quote", amountNok: null }, deliveryWeeks: null, contactNeed: "systems" },
  { slug: "recruitment", key: "recruitment", icon: "Users", portfolio: ["recruitmentSupport", "candidateSourcing", "technicalRecruitment", "recruitmentWorkflow"], related: ["digital-operations", "automation"], pricing: { kind: "quote", amountNok: null }, deliveryWeeks: null, contactNeed: "recruitment" },
  { slug: "automation", key: "automation", icon: "Workflow", portfolio: ["businessAutomation", "workflowAutomation", "internalTools", "repetitiveTaskAutomation"], related: ["crm", "data-collection", "digital-operations"], pricing: { kind: "quote", amountNok: null }, deliveryWeeks: null, contactNeed: "automation" },
  { slug: "digital-operations", key: "digitalPartner", icon: "RefreshCw", portfolio: ["websiteMaintenance", "contentUpdates", "technicalMaintenance", "seoSupport"], related: ["web-development", "seo", "crm"], pricing: { kind: "monthly", amountNok: null }, deliveryWeeks: null, contactNeed: "ongoing" },
];

/** The long-term partner page is presented separately from the single-service cards. */
export const PARTNER_PAGE_SLUG = "digital-operations";

export const SERVICE_PAGE_SLUGS = SERVICE_PAGES.map((p) => p.slug);

export function getServicePage(slug: string) {
  return SERVICE_PAGES.find((p) => p.slug === slug);
}
