import { z } from "zod";
import { socialUrl } from "@/config/social";
import { INDUSTRIES } from "@/config/industries";
import { LANGUAGE_CODES } from "@/config/languages";

/**
 * Every system setting has a Zod schema with defaults, so a missing or
 * partially-stored value always resolves to a complete, valid object.
 */
const socialLinkSchema = z.string().trim().max(300).refine((value) => {
  if (!value) return true;
  return !!socialUrl(value);
}, "Use a valid HTTPS link");

const whatsappLinkSchema = z.string().trim().max(300).transform((value) => {
  const digits = value.replace(/\D/g, "");
  return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 8 && digits.length <= 15
    ? `https://wa.me/${digits}`
    : value;
}).pipe(socialLinkSchema);

export const generalSettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(100).default("ExploreTechify"),
  tagline: z.string().trim().max(200).default("Websites That Turn Visitors Into Customers."),
  logoText: z.string().trim().max(40).default("ExploreTechify"),
  contactEmail: z.string().trim().max(200).default("hello@exploretechify.com"),
  contactPhone: z.string().trim().max(50).default(""),
  address: z.string().trim().max(300).default(""),
  social: z
    .object({
      whatsapp: whatsappLinkSchema.default(""),
      facebook: socialLinkSchema.default(""),
      discord: socialLinkSchema.default(""),
      linkedin: socialLinkSchema.default(""),
      x: socialLinkSchema.default(""),
      instagram: socialLinkSchema.default(""),
      youtube: socialLinkSchema.default(""),
    })
    .default({ whatsapp: "", facebook: "", discord: "", linkedin: "", x: "", instagram: "", youtube: "" }),
});

export const languageSettingsSchema = z.object({
  enabled: z
    .array(z.string().refine((v) => (LANGUAGE_CODES as string[]).includes(v)))
    .min(1)
    .default([...LANGUAGE_CODES])
    .transform((list) => (list.includes("en") ? list : ["en", ...list])),
  /** Default language for new client accounts, templates and x-default. URL routing keeps English unprefixed. */
  defaultLanguage: z.string().refine((v) => (LANGUAGE_CODES as string[]).includes(v)).default("en"),
});

export const SCORING_RULE_IDS = [
  "newly_registered",
  "relevant_industry",
  "no_website",
  "weak_website",
  "email_available",
  "phone_available",
  "hiring",
  "digital_opportunity",
  "limited_company",
] as const;
export type ScoringRuleId = (typeof SCORING_RULE_IDS)[number];

export const scoringRuleSchema = z.object({
  id: z.enum(SCORING_RULE_IDS),
  label: z.string().trim().min(1).max(80),
  points: z.number().int().min(-50).max(50),
  enabled: z.boolean(),
});

export const DEFAULT_SCORING_RULES: z.infer<typeof scoringRuleSchema>[] = [
  { id: "newly_registered", label: "Newly registered", points: 15, enabled: true },
  { id: "relevant_industry", label: "Relevant industry", points: 20, enabled: true },
  { id: "no_website", label: "No website", points: 15, enabled: true },
  { id: "weak_website", label: "Weak website (audit)", points: 10, enabled: true },
  { id: "email_available", label: "Email available", points: 10, enabled: true },
  { id: "phone_available", label: "Phone available", points: 5, enabled: true },
  { id: "hiring", label: "Hiring activity", points: 12, enabled: true },
  { id: "digital_opportunity", label: "Digital opportunity", points: 10, enabled: true },
  { id: "limited_company", label: "Limited company", points: 8, enabled: true },
];

export const leadScoringSettingsSchema = z.object({
  qualifiedThreshold: z.number().int().min(0).max(100).default(60),
  newlyRegisteredDays: z.number().int().min(1).max(365).default(45),
  relevantIndustries: z.array(z.enum(INDUSTRIES)).default(INDUSTRIES.filter((i) => i !== "other")),
  limitedLegalForms: z
    .array(z.string())
    .default(["AS", "ASA", "AB", "ApS", "A/S", "Oy", "Oyj", "GmbH", "UG", "AG", "SAS", "SASU", "SARL", "Ltd", "PLC"]),
  rules: z.array(scoringRuleSchema).default(DEFAULT_SCORING_RULES),
});

export const outreachSettingsSchema = z.object({
  /** Human approval is mandatory and cannot be disabled. */
  requireApproval: z.literal(true).default(true),
  allowSelfApproval: z.boolean().default(false),
  dailySendLimit: z.number().int().min(1).max(1000).default(50),
  senderName: z.string().trim().max(100).default("ExploreTechify"),
  senderEmail: z.string().trim().max(200).default("hello@exploretechify.com"),
  postalAddress: z.string().trim().max(300).default(""),
  footer: z
    .string()
    .trim()
    .max(1000)
    .default("You received this email because your company was recently registered in a public business register. If you'd prefer not to hear from us, unsubscribe here: {{unsubscribeUrl}}"),
});

export const chatSettingsSchema = z.object({
  /** Internal users who receive new-client-message notifications. Empty → all with chat.manage. */
  recipientUserIds: z.array(z.string()).default([]),
  defaultAssigneeId: z.string().optional().nullable(),
  emailNotifications: z.boolean().default(true),
  browserNotifications: z.boolean().default(true),
  workingHours: z
    .object({
      timezone: z.string().default("Europe/Oslo"),
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      start: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
      end: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
    })
    .default({ timezone: "Europe/Oslo", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }),
  autoResponse: z
    .object({
      enabled: z.boolean().default(true),
      outsideHoursOnly: z.boolean().default(false),
      message: z
        .string()
        .max(1000)
        .default("Thank you for your message. Our team has received it and will respond as soon as possible."),
    })
    .default({ enabled: true, outsideHoursOnly: false, message: "Thank you for your message. Our team has received it and will respond as soon as possible." }),
  availabilityText: z.string().max(200).default("Usually responds during business hours"),
});

const paidProviderSchema = z.object({
  enabled: z.boolean().default(false),
  /** Lower runs first. */
  priority: z.number().int().min(1).max(10).default(5),
  /** Owner-entered cost per call in cents (depends on the plan you buy). */
  costCentsPerCall: z.number().min(0).max(10_000).default(0),
});

/**
 * Contact research. Free steps (registry re-check, official website) always
 * run; paid providers run only when enabled, within budget, for the target profile.
 */
export const researchSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Retry schedule after the initial attempt (days). Product defaults, not provider guarantees. */
  retryDays: z.array(z.number().int().min(1).max(365)).max(10).default([1, 3, 7, 14, 30]),
  /** Research companies registered within this many days (newest first). */
  backfillDays: z.number().int().min(0).max(365).default(90),
  maxPagesPerWebsite: z.number().int().min(1).max(10).default(5),
  /** Try plausible domains / web search when the registry lists no website. */
  websiteDiscovery: z.boolean().default(true),
  /** A value used by at least this many companies is treated as an intermediary. */
  sharedContactThreshold: z.number().int().min(2).max(50).default(3),
  /** Cache negative paid lookups this long before paying again. */
  negativeCacheDays: z.number().int().min(1).max(180).default(14),
  providers: z
    .object({
      hunter: paidProviderSchema.default({ enabled: false, priority: 2, costCentsPerCall: 0 }),
      apollo: paidProviderSchema.default({ enabled: false, priority: 3, costCentsPerCall: 0 }),
      brave: paidProviderSchema.default({ enabled: false, priority: 1, costCentsPerCall: 0 }),
    })
    .default({ hunter: { enabled: false, priority: 2, costCentsPerCall: 0 }, apollo: { enabled: false, priority: 3, costCentsPerCall: 0 }, brave: { enabled: false, priority: 1, costCentsPerCall: 0 } }),
  /** Verify emails with Hunter Email Verifier (paid) after free MX checks. */
  verifyEmailsWithHunter: z.boolean().default(false),
  maxCostPerCompanyCents: z.number().int().min(0).max(100_000).default(50),
  dailyBudgetCents: z.number().int().min(0).max(10_000_000).default(0),
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000).default(0),
  /** Paid research only for companies matching this profile (empty = all). */
  paidTargets: z
    .object({
      countries: z.array(z.string()).default([]),
      industries: z.array(z.enum(INDUSTRIES)).default([]),
      maxAgeDays: z.number().int().min(0).max(365).default(30),
    })
    .default({ countries: [], industries: [], maxAgeDays: 30 }),
  inbox: z
    .object({
      newContactable: z.boolean().default(true),
      verificationChanges: z.boolean().default(true),
      serviceMatches: z.boolean().default(true),
      reviewNeeded: z.boolean().default(true),
      minServiceFitScore: z.number().int().min(0).max(100).default(70),
      /** Max new-contactable items per country per day (0 = unlimited). */
      maxPerCountryPerDay: z.number().int().min(0).max(1000).default(50),
    })
    .default({ newContactable: true, verificationChanges: true, serviceMatches: true, reviewNeeded: true, minServiceFitScore: 70, maxPerCountryPerDay: 50 }),
});

/** Website visitor analytics (Owner-only). Records expire after `retentionDays`. */
export const analyticsSettingsSchema = z.object({
  retentionDays: z.number().int().min(30).max(760).default(395),
});

export const SETTING_SCHEMAS = {
  general: generalSettingsSchema,
  analytics: analyticsSettingsSchema,
  languages: languageSettingsSchema,
  leadScoring: leadScoringSettingsSchema,
  outreach: outreachSettingsSchema,
  chat: chatSettingsSchema,
  research: researchSettingsSchema,
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;
export type LeadScoringSettings = SettingValue<"leadScoring">;
export type ChatSettings = SettingValue<"chat">;
export type OutreachSettings = SettingValue<"outreach">;
export type ResearchSettings = SettingValue<"research">;
