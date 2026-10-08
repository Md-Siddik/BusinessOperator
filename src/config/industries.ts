/**
 * Industry taxonomy, NACE-based classification and reusable service bundles
 * for industry personalization. One configuration drives the public website,
 * lead scoring and outreach suggestions — no per-industry code paths.
 */
export const INDUSTRIES = [
  "ecommerce", "retail", "technology", "professionalServices", "consulting", "construction",
  "manufacturing", "printing", "design", "logistics", "hospitality", "health", "realEstate",
  "localServices", "other",
] as const;

export type IndustryKey = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<IndustryKey, string> = {
  ecommerce: "E-commerce",
  retail: "Retail",
  technology: "Technology",
  professionalServices: "Professional services",
  consulting: "Consulting",
  construction: "Construction",
  manufacturing: "Manufacturing",
  printing: "Printing",
  design: "Design",
  logistics: "Logistics",
  hospitality: "Hospitality",
  health: "Health & wellness",
  realEstate: "Real estate",
  localServices: "Local services",
  other: "Other",
};

/** NACE Rev.2 prefix → industry. Longest matching prefix wins. */
const NACE_MAP: Array<[string, IndustryKey]> = [
  ["47.91", "ecommerce"], ["70.22", "consulting"], ["74.1", "design"], ["58.2", "technology"],
  ["62", "technology"], ["63", "technology"], ["18", "printing"], ["47", "retail"], ["46", "retail"],
  ["41", "construction"], ["42", "construction"], ["43", "construction"],
  ["49", "logistics"], ["52", "logistics"], ["53", "logistics"],
  ["55", "hospitality"], ["56", "hospitality"], ["86", "health"], ["96.02", "health"], ["96.04", "health"],
  ["68", "realEstate"], ["69", "professionalServices"], ["70", "consulting"], ["71", "professionalServices"],
  ["73", "professionalServices"], ["74", "professionalServices"], ["78", "professionalServices"],
  ["45", "localServices"], ["81", "localServices"], ["95", "localServices"], ["96", "localServices"],
];
for (let n = 10; n <= 33; n++) if (n !== 18) NACE_MAP.push([String(n), "manufacturing"]);
const SORTED_NACE = [...NACE_MAP].sort((a, b) => b[0].length - a[0].length);

export function classifyIndustry(naceCode: string | undefined | null): IndustryKey {
  if (!naceCode) return "other";
  const code = naceCode.trim();
  for (const [prefix, key] of SORTED_NACE) {
    const matches = prefix.includes(".") ? code.startsWith(prefix) : code === prefix || code.startsWith(`${prefix}.`);
    if (matches) return key;
  }
  return "other";
}

export function isIndustryKey(v: unknown): v is IndustryKey {
  return typeof v === "string" && (INDUSTRIES as readonly string[]).includes(v);
}

/** Personalised service combinations (spec §10). Items reference service item keys. */
export const INDUSTRY_PROFILES = [
  { key: "ecommerce", industries: ["ecommerce", "retail"], items: ["businessWebsite", "ecommerce", "seo", "inventoryManagement", "crm", "businessAutomation"] },
  { key: "technology", industries: ["technology"], items: ["businessWebsite", "technicalRecruitment", "internalTools", "workflowAutomation", "crm"] },
  { key: "localBusiness", industries: ["localServices", "hospitality", "health", "construction", "realEstate"], items: ["businessWebsite", "googleBusinessProfile", "localSeo", "socialMediaSupport", "leadGenerationSystems"] },
  { key: "hiring", industries: [], items: ["recruitmentSupport", "candidateSourcing", "recruitmentWorkflow", "employeeOnboarding"] },
  { key: "professional", industries: ["professionalServices", "consulting", "design", "printing"], items: ["businessWebsite", "businessEmail", "seo", "crm", "contentSupport"] },
  { key: "operations", industries: ["manufacturing", "logistics"], items: ["businessWebsite", "orderManagement", "businessDashboards", "reportingAutomation", "recruitmentSupport"] },
] as const;

export type IndustryProfileKey = (typeof INDUSTRY_PROFILES)[number]["key"];

export function profileForIndustry(industry: string | undefined, hiring?: boolean) {
  if (hiring) return INDUSTRY_PROFILES.find((p) => p.key === "hiring")!;
  return (
    INDUSTRY_PROFILES.find((p) => (p.industries as readonly string[]).includes(industry ?? "")) ??
    INDUSTRY_PROFILES.find((p) => p.key === "professional")!
  );
}
