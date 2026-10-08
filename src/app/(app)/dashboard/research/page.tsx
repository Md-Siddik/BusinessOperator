import { requireInternalPage } from "@/lib/auth/session";
import { RESEARCH_STATUS_LABELS, type ResearchStatus } from "@/lib/company-fields";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { researchReport } from "@/features/research/reports";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";

export const metadata = { title: "Research operations" };

const money = (cents: number) => (cents / 100).toFixed(2);

/** Contact research operations: queue, budget, provider spend, coverage by registration-age cohort, workers. */
export default async function ResearchOpsPage() {
  const actor = await requireInternalPage("companies.read");
  const r = await researchReport(actor);
  const providers = [...new Set(r.usage.map((u) => u.provider))];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Research" title="Research operations" description="How contact research is going: queue, budget, provider spend and direct-contact coverage by country and registration age. Budgets and providers are set in Settings → Research." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Budget" />
          <CardContent className="space-y-1 text-sm">
            <p>
              Today: <strong className="tabular-nums">{money(r.budget.todayCents)}</strong> / {money(r.budget.dailyBudgetCents)}
            </p>
            <p>
              This month: <strong className="tabular-nums">{money(r.budget.monthCents)}</strong> / {money(r.budget.monthlyBudgetCents)}
            </p>
            {r.budget.paused && <p className="text-xs text-amber-700">Paid lookups are paused (a budget of 0 means no paid calls). Free registry + website research still runs.</p>}
            <p className="pt-2 text-xs text-ink-500">
              Cost per newly contactable company (30 days, paid research): {r.costPerNewlyContactableCents === null ? "— (no paid contact found yet)" : money(r.costPerNewlyContactableCents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Research status" />
          <CardContent>
            <ul className="space-y-1 text-sm">
              {Object.entries(r.statusCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <li key={k} className="flex justify-between">
                    <span>{RESEARCH_STATUS_LABELS[k as ResearchStatus] ?? k}</span>
                    <span className="tabular-nums">{formatNumber(n)}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">{r.reviewPending} contact value(s) waiting in the review queue.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Workers" />
          <CardContent className="space-y-1 text-sm">
            <p>Scheduler: {r.scheduler.running ? "running" : "not running in this process (use /api/jobs/cron)"}</p>
            <p className="text-xs text-ink-500">Last fast tick: {r.scheduler.lastFastAt ? formatDateTime(r.scheduler.lastFastAt) : "—"} · last slow tick: {r.scheduler.lastSlowAt ? formatDateTime(r.scheduler.lastSlowAt) : "—"}</p>
            <p>Companies House stream: {r.stream.configured ? (r.stream.running ? "connected / reconnecting" : "stopped") : "no streaming key"}</p>
            {r.stream.lastError && <p className="text-xs text-amber-700">{r.stream.lastError}</p>}
            <ul className="pt-1 text-xs text-ink-600">
              {r.queue.map((q) => (
                <li key={`${q.type}-${q.status}`}>
                  {q.type} · {q.status.toLowerCase()}: {q.count}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Direct-contact coverage by registration age" description="Share of new legal entities with at least one usable email or phone. Older cohorts have had more research attempts." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Country</th>
                {r.cohorts.map((c) => (
                  <th key={c.key} className="px-4 py-2.5 text-right">
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right">Measured feed delay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {r.coverage.map((row) => (
                <tr key={row.code}>
                  <td className="px-4 py-2.5 font-medium">
                    <span aria-hidden>{row.flag}</span> {row.name}
                  </td>
                  {r.cohorts.map((c) => {
                    const v = row.cohorts[c.key]!;
                    return (
                      <td key={c.key} className="px-4 py-2.5 text-right tabular-nums">
                        {v.pct === null ? "—" : `${v.pct}%`} <span className="text-xs text-ink-400">({v.direct}/{v.total})</span>
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right text-xs text-ink-600">{row.feed?.samples ? `median ${row.feed.medianSeconds}s · p90 ${row.feed.p90Seconds}s (${row.feed.samples} events)` : "not measured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Provider calls (30 days)" />
        <CardContent>
          {providers.length ? (
            <ul className="space-y-1 text-sm">
              {providers.map((p) => {
                const rows = r.usage.filter((u) => u.provider === p);
                return (
                  <li key={p}>
                    <span className="font-medium">{p}</span>: {rows.map((x) => `${x.outcome.toLowerCase()} ${x.calls}`).join(" · ")} — cost {money(rows.reduce((a, x) => a + x.costCents, 0))}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-500">No paid provider calls yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
