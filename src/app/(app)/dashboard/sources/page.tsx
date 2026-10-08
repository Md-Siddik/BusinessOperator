import { Check, ExternalLink, Minus } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDateTime, formatRelative } from "@/lib/utils/format";
import { listCountries, listSyncHistory } from "@/features/countries/service";
import { SOURCE_TYPE_LABELS, type ProviderCapabilities } from "@/features/registry/types";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { ConnectionDot, FreshnessBadge } from "@/components/intel/quality";
import { SourceActions } from "@/components/intel/source-actions";
import { feedDelayStats } from "@/features/registry/live";

export const metadata = { title: "Data sources" };

const CAPS: [keyof ProviderCapabilities, string][] = [
  ["supportsDailyRegistrations", "Daily registrations"],
  ["supportsRegistrationDate", "Registration date"],
  ["supportsEmail", "Email"],
  ["supportsPhone", "Phone"],
  ["supportsMobile", "Mobile"],
  ["supportsWebsite", "Website"],
  ["supportsAddress", "Address"],
  ["supportsIndustry", "Industry"],
  ["supportsRoles", "Roles / directors"],
  ["supportsSourceUrl", "Official record link"],
];

function duration(ms?: number | null) {
  if (!ms) return "—";
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Provider status panel + registry synchronization log. */
export default async function SourcesPage() {
  const actor = await requireInternalPage("companies.read");
  const [all, history] = await Promise.all([listCountries(), listSyncHistory({ limit: 60 })]);
  const countries = all.filter((c) => c.enabled || c.jurisdiction.providers.length);
  const delays = Object.fromEntries(await Promise.all(countries.map(async (c) => [c.code, c.provider ? await feedDelayStats(c.provider.id) : null] as const)));
  const canSync = can(actor, "registry.sync");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company Intelligence"
        title="Data sources"
        description="Which official source feeds each country, what it provides, how fresh it is, and every synchronization run. Nothing is labelled real-time unless the source is. Jurisdictions without an adapter are listed under European coverage."
      />

      <ul className="grid gap-4 lg:grid-cols-2">
        {countries.map((c) => {
          const p = c.provider;
          return (
            <li key={c.code} id={c.code} className="scroll-mt-24 rounded-2xl border border-ink-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink-900">
                    <span aria-hidden>{c.flag}</span> {c.name}
                    {!c.enabled && <span className="ml-2 text-xs font-normal text-ink-500">(disabled)</span>}
                  </h2>
                  <p className="text-sm text-ink-600">
                    {p?.sourceName ?? c.registryName}
                    {p && <span className="text-ink-400"> · {SOURCE_TYPE_LABELS[p.sourceType]}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <ConnectionDot state={c.state} />
                  {p && p.freshness !== "UNKNOWN" && <FreshnessBadge freshness={p.freshness} />}
                </div>
              </div>

              {c.stateMessage && c.state !== "CONNECTED" && <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{c.stateMessage}</p>}
              {p?.description && <p className="mt-3 text-sm text-ink-600">{p.description}</p>}

              {p && p.capabilities.supportsDailyRegistrations && (
                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  {CAPS.map(([key, label]) => (
                    <li key={key} className={p.capabilities[key] ? "flex items-center gap-1.5 text-ink-800" : "flex items-center gap-1.5 text-ink-400"}>
                      {p.capabilities[key] ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
                      {label}
                      <span className="sr-only">{p.capabilities[key] ? "provided" : "not provided"}</span>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-500">Last successful sync</dt>
                  <dd>{c.lastSuccessAt ? `${formatDateTime(c.lastSuccessAt)} (${formatRelative(c.lastSuccessAt)})` : "Never"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Latest source publication</dt>
                  <dd>{c.latestPublicationAt ? formatDateTime(c.latestPublicationAt) : "Not published by the source / not checked"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Measured feed delay</dt>
                  <dd>{delays[c.code]?.samples ? `median ${delays[c.code]!.medianSeconds}s · p90 ${delays[c.code]!.p90Seconds}s (${delays[c.code]!.samples} events)` : "Not measured"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Automatic sync</dt>
                  <dd>{c.dailyFeed ? (c.syncEnabled ? `Every ${c.syncIntervalMinutes >= 60 ? `${Math.round(c.syncIntervalMinutes / 60)} h` : `${c.syncIntervalMinutes} min`}` : "Off") : "—"}</dd>
                </div>
                {p && p.requiredEnv.length > 0 && (
                  <div className="col-span-2">
                    <dt className="text-xs text-ink-500">Credentials (server environment)</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {p.requiredEnv.map((e) => (
                        <code key={e} className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">
                          {e}
                        </code>
                      ))}
                      <span className={p.configured ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>{p.configured ? "configured" : "not set"}</span>
                    </dd>
                  </div>
                )}
                <div className="col-span-2">
                  <dt className="text-xs text-ink-500">Timezone for “today”</dt>
                  <dd>{c.timezone}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <SourceActions country={c.code} canSync={canSync && c.enabled} dailyFeed={c.dailyFeed} />
                <div className="flex gap-3 text-sm">
                  {p?.docsUrl && (
                    <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      API documentation <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                  <span className="text-ink-400">docs/providers/{c.slug === "gb" ? "united-kingdom" : c.name.toLowerCase()}.md</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Card>
        <CardHeader title="Synchronization log" description="Every manual, scheduled and initial sync run. Failed runs never replace stored data." />
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-ink-50 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Country</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5">Started</th>
                <th className="px-4 py-2.5">Range</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">New</th>
                <th className="px-4 py-2.5 text-right">Updated</th>
                <th className="px-4 py-2.5 text-right">Skipped</th>
                <th className="px-4 py-2.5 text-right">Failed</th>
                <th className="px-4 py-2.5 text-right">Duration</th>
                <th className="px-4 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {history.map((h) => (
                <tr key={String(h._id)} className="align-top">
                  <td className="px-4 py-2.5 font-medium">{h.countryCode}</td>
                  <td className="px-4 py-2.5 text-ink-600">
                    {h.providerId}
                    <span className="block text-xs text-ink-400">{h.trigger.toLowerCase()}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(h.startedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-600">{h.rangeFrom ? (h.rangeFrom === h.rangeTo ? h.rangeFrom : `${h.rangeFrom} → ${h.rangeTo}`) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={h.status} />
                    {h.status === "RUNNING" && h.progress && <span className="block text-xs text-ink-500">{h.progress}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{h.imported}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{h.updated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{h.skipped ?? 0}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{h.failed}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{duration(h.durationMs)}</td>
                  <td className="max-w-[18rem] px-4 py-2.5 text-xs text-ink-500">{h.errorLog?.[0] ?? (h.sourceTotal !== undefined && h.sourceTotal !== null ? `Source reported ${h.sourceTotal}` : "")}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-sm text-ink-500">
                    No syncs yet. Connected registries sync automatically shortly after start-up.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
