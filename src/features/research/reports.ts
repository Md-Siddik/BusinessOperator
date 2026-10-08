import "server-only";
import { getCountry } from "@/config/countries";
import { Company, Contact, ProviderUsage } from "@/models";
import { companyVisibilityFilter } from "@/lib/data-mode";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { queueStats } from "@/features/jobs/queue";
import { getEnabledCountries } from "@/features/countries/service";
import { feedDelayStats } from "@/features/registry/live";
import { streamStatus } from "@/features/registry/companies-house-stream";
import { schedulerStatus } from "@/features/registry/scheduler";
import { budgetSummary } from "./budget";

const COHORTS = [
  { key: "sameDay", label: "Same day", min: 0, max: 0 },
  { key: "d3", label: "1–3 days", min: 1, max: 3 },
  { key: "d7", label: "4–7 days", min: 4, max: 7 },
  { key: "d30", label: "8–30 days", min: 8, max: 30 },
] as const;

/** Research operations report: queue, budget, provider spend, coverage by country × registration-age cohort. */
export async function researchReport(actor: Actor) {
  if (!can(actor, "companies.read")) throw Errors.forbidden();
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [queue, budget, statusCounts, usage, newlyContactable, reviewPending] = await Promise.all([
    queueStats(),
    budgetSummary(),
    Company.aggregate<{ _id: string; n: number }>([{ $match: { ...companyVisibilityFilter() } }, { $group: { _id: { $ifNull: ["$research.status", "NOT_STARTED"] }, n: { $sum: 1 } } }]),
    ProviderUsage.aggregate<{ _id: { provider: string; outcome: string }; calls: number; cost: number }>([{ $match: { at: { $gte: since30 } } }, { $group: { _id: { provider: "$provider", outcome: "$outcome" }, calls: { $sum: 1 }, cost: { $sum: "$costCents" } } }]),
    Company.countDocuments({ contactFoundAt: { $gte: since30 }, "research.costCents": { $gt: 0 } }),
    Contact.countDocuments({ review: "PENDING" }),
  ]);
  const totalCost = usage.reduce((a, u) => a + u.cost, 0);

  const countries = (await getEnabledCountries()).filter((c) => c.dailyFeed || c.state === "PROVIDER_ERROR");
  const coverage = [];
  for (const c of countries) {
    const today = todayIn(getCountry(c.code)!.timezone);
    const row: Record<string, { total: number; direct: number; pct: number | null }> = {};
    for (const k of COHORTS) {
      const from = addDays(today, -k.max);
      const to = addDays(today, -k.min);
      const [agg] = await Company.aggregate<{ total: number; direct: number }>([
        { $match: { countryCode: c.code, registrationDay: { $gte: from, $lte: to }, eventType: { $in: ["NEW_ENTITY", null] }, ...companyVisibilityFilter() } },
        { $group: { _id: null, total: { $sum: 1 }, direct: { $sum: { $cond: ["$directContact.has", 1, 0] } } } },
      ]);
      row[k.key] = { total: agg?.total ?? 0, direct: agg?.direct ?? 0, pct: agg?.total ? Math.round(((agg.direct ?? 0) / agg.total) * 100) : null };
    }
    coverage.push({ code: c.code, name: c.name, flag: c.flag, cohorts: row, feed: c.provider ? await feedDelayStats(c.provider.id) : null });
  }

  return {
    queue,
    budget,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
    usage: usage.map((u) => ({ provider: u._id.provider, outcome: u._id.outcome, calls: u.calls, costCents: u.cost })),
    totalCostCents30d: totalCost,
    newlyContactablePaid30d: newlyContactable,
    costPerNewlyContactableCents: newlyContactable ? Math.round(totalCost / newlyContactable) : null,
    reviewPending,
    cohorts: COHORTS.map((c) => ({ key: c.key, label: c.label })),
    coverage,
    stream: streamStatus(),
    scheduler: schedulerStatus(),
  };
}
