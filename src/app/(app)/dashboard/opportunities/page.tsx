import { ownerMetadata } from "@/features/opportunities/metadata";
import Link from "next/link";
import { AlertTriangle, Briefcase, Building2, CalendarClock, CircleDot, Copy, Eye, FileText, ShieldCheck, XCircle } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { getCountryCoverage, getOpportunityStats, listFeeds, listOpportunities } from "@/features/opportunities/service";
import { METRIC_DEFINITIONS, OPPORTUNITY_TYPE_LABELS } from "@/features/opportunities/constants";
import { formatAge } from "@/features/opportunities/format";
import { Card, CardHeader } from "@/components/ui/card";
import { KpiCard, PageHeader } from "@/components/ui/data";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { buttonClasses } from "@/components/ui/button";
import { CountrySupportBadge, ProviderStateBadge } from "@/components/opportunities/badges";
import { OpportunityTable, type OpportunityRow } from "@/components/opportunities/opportunity-table";
import { cn } from "@/lib/utils";

export const generateMetadata = ownerMetadata("Opportunity overview");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OpportunityOverviewPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireOwnerPage();
  const sp = await searchParams;
  const days = sp.days === "30" ? 30 : sp.days === "1" ? 1 : 7;
  const [stats, coverage, { feeds }, recent] = await Promise.all([
    getOpportunityStats(actor, { periodDays: days }),
    getCountryCoverage(actor),
    listFeeds(actor),
    listOpportunities(actor, { sort: "discovered", pageSize: 8 }),
  ]);
  const failing = feeds.filter((f) => f.state === "PROVIDER_ERROR");
  const providerFeeds = feeds.filter((f) => f.kind === "PROVIDER");
  const rows = JSON.parse(JSON.stringify(recent.items)) as OpportunityRow[];
  const period = days === 1 ? "last 24 hours" : `last ${days} days`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Owner only"
        title="Verified Opportunity Intelligence"
        description="Genuine hiring and service-purchasing opportunities from official employer and procurement sources. Every number below is counted from stored records using the definition shown with it."
        actions={
          <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm" role="group" aria-label="Period">
            {[
              ["1", "24 h"],
              ["7", "7 days"],
              ["30", "30 days"],
            ].map(([v, l]) => (
              <Link key={v} href={`/dashboard/opportunities?days=${v}`} aria-current={String(days) === v ? "true" : undefined} className={cn("rounded-md px-3 py-1", String(days) === v ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900")}>
                {l}
              </Link>
            ))}
          </div>
        }
      />

      {failing.length > 0 && (
        <Alert tone="warning" title={`${failing.length} source${failing.length === 1 ? "" : "s"} failing`} action={<Link href="/dashboard/opportunities/health" className="text-sm font-medium underline">View sync health</Link>}>
          {failing.map((f) => f.label).join(", ")}. Existing records are kept; they are never closed because a source is unreachable.
        </Alert>
      )}

      {stats.total === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No verified opportunities stored yet."
            description="Open sources (TED, Arbetsförmedlingen, Find a Tender, Contracts Finder, BOAMP) synchronize automatically on the worker schedule. Credentialed sources stay off until configured. Nothing is shown until real records are retrieved."
            action={
              <Link href="/dashboard/opportunities/sources" className={buttonClasses("primary", "sm")}>
                Review sources & settings
              </Link>
            }
          />
        </Card>
      ) : (
        <section aria-labelledby="metrics" className="space-y-3">
          <h2 id="metrics" className="sr-only">
            Metrics
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={`Discovered · ${period}`} value={stats.discovered} icon={FileText} tone="brand" hint={`${stats.discoveredByType.HIRING} hiring · ${stats.discoveredByType.PROCUREMENT} service & project`} href={`/dashboard/opportunities/hiring?dateField=discovered&preset=${days === 1 ? "today" : days === 30 ? "30d" : "7d"}&activity=all`} />
            <KpiCard label="Active (status checked)" value={stats.activeChecked} icon={CircleDot} tone="success" hint="Listed by the source at its last check" />
            <KpiCard label="From official sources" value={stats.official} icon={ShieldCheck} tone="success" hint="Open · employer, ATS, portal or public service" />
            <KpiCard label="Tender deadlines ≤ 14 days" value={stats.deadlines} icon={CalendarClock} tone="warning" href="/dashboard/opportunities/procurement?dateField=deadline&preset=30d&sort=deadline" />
            <KpiCard label="Awaiting manual review" value={stats.review} icon={Eye} tone="warning" href="/dashboard/opportunities/review" />
            <KpiCard label="Distinct hiring organizations" value={stats.hiringOrgs} icon={Building2} hint={`Across ${stats.openByType.HIRING} open hiring postings`} />
            <KpiCard label="Closed or expired" value={stats.closed} icon={XCircle} hint={`${stats.removed} removed at source`} />
            <KpiCard label={`Sync failures · ${period}`} value={stats.syncFailures} icon={AlertTriangle} tone={stats.syncFailures ? "warning" : "neutral"} hint={`${stats.duplicates} duplicate source records folded`} href="/dashboard/opportunities/health" />
          </div>
          <details className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink-700">Metric definitions</summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(METRIC_DEFINITIONS).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{k.replace(/([A-Z])/g, " $1")}</dt>
                  <dd className="text-ink-700">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="Recently discovered" description="Newest by discovery time (open opportunities, canonical records)." action={<Link href="/dashboard/opportunities/hiring" className="text-sm text-brand-700 hover:underline">All hiring</Link>} />
          {rows.length ? <OpportunityTable rows={rows} /> : <EmptyState icon={Briefcase} title="No verified opportunities available yet." />}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Countries" description="Operational status per opportunity type." action={<Link href="/dashboard/opportunities/countries" className="text-sm text-brand-700 hover:underline">Details</Link>} />
            <ul className="divide-y divide-ink-100">
              {coverage.map((c) => (
                <li key={c.code} className="px-5 py-3">
                  <p className="text-sm font-medium text-ink-900">
                    <span aria-hidden>{c.flag}</span> {c.name}
                  </p>
                  <div className="mt-1.5 grid gap-1">
                    {c.types.map((t) => (
                      <div key={t.type} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-ink-500">{OPPORTUNITY_TYPE_LABELS[t.type]}</span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-ink-600">{t.open} open</span>
                          <CountrySupportBadge support={t.support} />
                        </span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Sources" description="Provider feeds and their last successful sync." action={<Link href="/dashboard/opportunities/sources" className="text-sm text-brand-700 hover:underline">Manage</Link>} />
            <ul className="divide-y divide-ink-100">
              {providerFeeds.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-ink-800">{f.label}</p>
                    <p className="text-xs text-ink-500">Last success: {f.health?.lastSuccessAt ? formatAge(f.health.lastSuccessAt) : "never"}</p>
                  </div>
                  <ProviderStateBadge state={f.state} />
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 border-t border-ink-100 px-5 py-2.5 text-xs text-ink-500">
              <Copy className="h-3 w-3" aria-hidden /> {feeds.filter((f) => f.kind === "EMPLOYER").length} employer feed(s) configured
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
