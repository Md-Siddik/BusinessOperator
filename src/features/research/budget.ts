import "server-only";
import type { Types } from "mongoose";
import { LookupCache, ProviderUsage } from "@/models";
import { getSetting } from "@/features/settings/service";
import type { ResearchSettings } from "@/features/settings/schemas";

export type PaidProviderId = "hunter" | "apollo" | "brave";

export type SpendDecision = { ok: true; costCents: number } | { ok: false; reason: "DISABLED" | "NO_KEY" | "BUDGET_DAILY" | "BUDGET_MONTHLY" | "COMPANY_LIMIT" | "NOT_TARGET" };

const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

async function spentSince(since: Date) {
  const [r] = await ProviderUsage.aggregate<{ c: number }>([{ $match: { at: { $gte: since } } }, { $group: { _id: null, c: { $sum: "$costCents" } } }]);
  return r?.c ?? 0;
}

/**
 * Decide whether a paid call may run. A budget of 0 means paid lookups are
 * paused — nothing is spent until the Owner sets a budget.
 */
export async function canSpend(provider: PaidProviderId, hasKey: boolean, company: { _id: Types.ObjectId | string; countryCode: string; industry?: string | null; registrationDay?: string | null; research?: { costCents?: number | null } | null }, settings?: ResearchSettings): Promise<SpendDecision> {
  const s = settings ?? (await getSetting("research"));
  const p = s.providers[provider];
  if (!p.enabled) return { ok: false, reason: "DISABLED" };
  if (!hasKey) return { ok: false, reason: "NO_KEY" };
  const t = s.paidTargets;
  if (t.countries.length && !t.countries.includes(company.countryCode)) return { ok: false, reason: "NOT_TARGET" };
  if (t.industries.length && !(t.industries as string[]).includes(company.industry ?? "other")) return { ok: false, reason: "NOT_TARGET" };
  if (t.maxAgeDays && company.registrationDay && Date.now() - Date.parse(`${company.registrationDay}T00:00:00Z`) > (t.maxAgeDays + 1) * 86_400_000) return { ok: false, reason: "NOT_TARGET" };
  const cost = p.costCentsPerCall;
  if ((company.research?.costCents ?? 0) + cost > s.maxCostPerCompanyCents) return { ok: false, reason: "COMPANY_LIMIT" };
  if (s.dailyBudgetCents <= 0 || (await spentSince(startOfUtcDay())) + cost > s.dailyBudgetCents) return { ok: false, reason: "BUDGET_DAILY" };
  if (s.monthlyBudgetCents <= 0 || (await spentSince(startOfUtcMonth())) + cost > s.monthlyBudgetCents) return { ok: false, reason: "BUDGET_MONTHLY" };
  return { ok: true, costCents: cost };
}

export async function recordUsage(entry: { provider: string; operation: string; companyId?: Types.ObjectId | string; countryCode?: string; costCents: number; outcome: "FOUND" | "NOT_FOUND" | "ERROR" | "QUOTA" | "CACHED"; detail?: string }) {
  await ProviderUsage.create({ ...entry, at: new Date() });
}

export async function getCached<T>(key: string): Promise<T | undefined> {
  const hit = await LookupCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean<{ result: T }>();
  return hit?.result;
}

export async function setCached(key: string, provider: string, result: unknown, days: number) {
  await LookupCache.updateOne({ key }, { $set: { provider, result, expiresAt: new Date(Date.now() + days * 86_400_000) } }, { upsert: true });
}

export async function budgetSummary() {
  const s = await getSetting("research");
  const [today, month] = await Promise.all([spentSince(startOfUtcDay()), spentSince(startOfUtcMonth())]);
  return { todayCents: today, monthCents: month, dailyBudgetCents: s.dailyBudgetCents, monthlyBudgetCents: s.monthlyBudgetCents, paused: s.dailyBudgetCents <= 0 || s.monthlyBudgetCents <= 0 };
}
