/**
 * Service catalogue structure. All human-readable text lives in the
 * translation dictionaries (messages/*.json → "services.*" and "serviceItems.*")
 * so every category is localizable and editable via Settings → Languages.
 */
export const SERVICE_CATEGORIES = [
  {
    slug: "digital-foundation",
    key: "digitalFoundation",
    icon: "Globe",
    items: ["businessWebsite", "ecommerce", "domainHosting", "businessEmail", "googleBusinessProfile", "socialMediaSetup", "analytics", "basicSeo"],
  },
  {
    slug: "digital-operations",
    key: "digitalOperations",
    icon: "RefreshCw",
    items: ["websiteMaintenance", "contentUpdates", "seoSupport", "socialMediaSupport", "technicalMaintenance", "digitalAssetManagement"],
  },
  {
    slug: "business-systems",
    key: "businessSystems",
    icon: "LayoutDashboard",
    items: ["crm", "inventoryManagement", "orderManagement", "businessDashboards", "dataManagement", "reporting", "internalTools", "workflowSystems"],
  },
  {
    slug: "growth-visibility",
    key: "growthVisibility",
    icon: "TrendingUp",
    items: ["seo", "localSeo", "contentSupport", "caseStudies", "digitalMarketingSupport", "googleAdsSupport", "socialMediaSupport", "conversionOptimization", "leadGenerationSystems"],
  },
  {
    slug: "people-recruitment",
    key: "peopleRecruitment",
    icon: "Users",
    items: ["recruitmentSupport", "candidateSourcing", "technicalRecruitment", "hrAdministration", "employeeOnboarding", "recruitmentWorkflow", "hrDataManagement"],
  },
  {
    slug: "automation-ai",
    key: "automationAi",
    icon: "Workflow",
    items: ["businessAutomation", "workflowAutomation", "aiAssistedWorkflows", "reportingAutomation", "crmAutomation", "internalTools", "repetitiveTaskAutomation"],
  },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type ServiceCategorySlug = ServiceCategory["slug"];

export const SERVICE_SLUGS = SERVICE_CATEGORIES.map((c) => c.slug) as ServiceCategorySlug[];

export function getServiceCategory(slug: string) {
  return SERVICE_CATEGORIES.find((c) => c.slug === slug);
}

/** Every distinct service item key — used by the contact form and client service assignment. */
export const SERVICE_ITEM_KEYS = Array.from(new Set(SERVICE_CATEGORIES.flatMap((c) => c.items as readonly string[])));
