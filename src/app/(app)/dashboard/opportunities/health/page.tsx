import { ownerMetadata } from "@/features/opportunities/metadata";
import Link from "next/link";
import { Activity } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { listFeeds, listSyncRuns } from "@/features/opportunities/service";
import { formatAge, formatInZone, formatInterval } from "@/features/opportunities/format";
import { schedulerStatus } from "@/features/registry/scheduler";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { ProviderStateBadge } from "@/components/opportunities/badges";

export const generateMetadata = ownerMetadata("Synchronization health");

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function HealthPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireOwnerPage();
  const sp = await searchParams;
  const failedOnly = sp.failed === "true";
  const [{ feeds }, runs] = await Promise.all([listFeeds(actor), listSyncRuns(actor, { limit: 150, failedOnly })]);
  const scheduler = schedulerStatus();
  const labelOf = new Map(feeds.map((f) => [f.id, f.label]));
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Opportunity Intelligence" title="Synchronization health" description="Every feed's schedule, last success, last error and recent runs. Failed runs never delete stored opportunities or mark them closed. Times in UTC." />

      {!scheduler.running && (
        <Alert tone="info" title="In-process scheduler not running in this instance">
          Feeds run on the existing worker schedule (slow tick). With REGISTRY_SCHEDULER=off, call /api/registry/cron (feeds) and /api/jobs/cron (manual runs) from an external scheduler.
        </Alert>
      )}

      <Card>
        <CardHeader title="Feeds" description={`${feeds.length} feeds · scheduler last ran ${scheduler.lastSlowAt ? formatAge(scheduler.lastSlowAt) : "— (not in this instance)"}`} />
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Feed</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5">Schedule</th>
                <th className="px-4 py-2.5">Last success</th>
                <th className="px-4 py-2.5">Next run</th>
                <th className="px-4 py-2.5">Failures</th>
                <th className="px-4 py-2.5">Last error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {feeds.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-2.5 font-medium text-ink-800">{f.label}</td>
                  <td className="px-4 py-2.5">
                    <ProviderStateBadge state={f.state} />
                    {f.running && <span className="ml-2 text-xs text-sky-700">running</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-600">{f.enabled ? formatInterval(f.intervalMinutes) : "off"}</td>
                  <td className="px-4 py-2.5 text-ink-600">{f.health?.lastSuccessAt ? `${formatInZone(f.health.lastSuccessAt, "UTC")} (${formatAge(f.health.lastSuccessAt)})` : "never"}</td>
                  <td className="px-4 py-2.5 text-ink-600">{f.enabled && f.nextRunAt ? formatAge(f.nextRunAt) : "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-600">{f.health?.consecutiveFailures ?? 0}</td>
                  <td className="max-w-xs px-4 py-2.5 text-xs text-red-700">{f.health?.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Recent runs"
          description="New = first discovered in this run. Out of scope = outside the supported countries or the configured filters."
          action={
            <Link href={failedOnly ? "/dashboard/opportunities/health" : "/dashboard/opportunities/health?failed=true"} className="text-sm text-brand-700 hover:underline">
              {failedOnly ? "Show all runs" : "Failed runs only"}
            </Link>
          }
        />
        {runs.length ? (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2.5">Feed</th>
                  <th className="px-4 py-2.5">Started (UTC)</th>
                  <th className="px-4 py-2.5">Trigger</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Fetched</th>
                  <th className="px-4 py-2.5 text-right">New</th>
                  <th className="px-4 py-2.5 text-right">Updated</th>
                  <th className="px-4 py-2.5 text-right">Unchanged</th>
                  <th className="px-4 py-2.5 text-right">Removed</th>
                  <th className="px-4 py-2.5 text-right">Dupes</th>
                  <th className="px-4 py-2.5 text-right">Out of scope</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {runs.map((r) => (
                  <tr key={String(r._id)}>
                    <td className="px-4 py-2 text-ink-800">{labelOf.get(String(r.feedId)) ?? r.feedKey}</td>
                    <td className="px-4 py-2 text-ink-600">{formatInZone(r.startedAt, "UTC")}</td>
                    <td className="px-4 py-2 text-xs text-ink-500">{r.trigger.toLowerCase()}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                      {r.rateLimited && <span className="ml-1 text-xs text-amber-700">rate limited</span>}
                      {r.complete === false && r.status !== "FAILED" && <span className="ml-1 text-xs text-ink-500">continues next run</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.fetched}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.created}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.updated}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.unchanged}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.removed}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.duplicatesLinked}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.outOfScope}</td>
                    <td className="px-4 py-2 text-ink-600">{r.durationMs ? `${Math.round(r.durationMs / 1000)} s` : "—"}</td>
                    <td className="max-w-xs px-4 py-2 text-xs text-red-700">{r.errorLog?.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Activity} title={failedOnly ? "No failed runs." : "No synchronization runs yet."} description="Runs appear once the worker has processed an enabled feed." />
        )}
      </Card>
    </div>
  );
}
