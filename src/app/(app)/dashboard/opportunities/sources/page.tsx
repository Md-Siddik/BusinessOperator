import { ownerMetadata } from "@/features/opportunities/metadata";
import { Check, ExternalLink, Minus } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { listFeeds } from "@/features/opportunities/service";
import { CANDIDATE_SOURCES } from "@/features/opportunities/providers";
import { COVERAGE_LABELS, OPPORTUNITY_TYPE_LABELS, SOURCE_CLASS_LABELS } from "@/features/opportunities/constants";
import { formatAge, formatInterval } from "@/features/opportunities/format";
import { getOpportunityCountry } from "@/config/opportunity-countries";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { Alert } from "@/components/ui/feedback";
import { ProviderStateBadge } from "@/components/opportunities/badges";
import { AddEmployerFeed, FeedControls, FeedSettingsForm } from "@/components/opportunities/feed-controls";

export const generateMetadata = ownerMetadata("Opportunity sources & settings");

const CAPS: [string, string][] = [
  ["incremental", "Incremental sync"],
  ["publishedAt", "Publication date"],
  ["updatedAt", "Update date"],
  ["deadline", "Deadline"],
  ["activityCheck", "Per-record status check"],
  ["contacts", "Published contacts"],
  ["directApplyLink", "Direct apply / submission link"],
];
const REMOVAL: Record<string, string> = { EXPLICIT: "Source reports removals explicitly", LISTING_DIFF: "Removal by complete-listing comparison", DEADLINE_ONLY: "Closure not reported — deadline only", NONE: "No closure information" };
const VERIFY_TEXT: Record<string, string> = {
  NOT_CHECKED: "Not checked yet",
  LINKED_FROM_OFFICIAL_DOMAIN: "Linked from the official website ✓",
  LINK_NOT_FOUND: "Not linked from the official website — records go to the verification queue",
  FETCH_FAILED: "Official website could not be read — will retry",
  SAME_DOMAIN: "On the employer's official domain ✓",
};

export default async function SourcesPage() {
  const actor = await requireOwnerPage();
  const { feeds, providers } = await listFeeds(actor);
  const providerFeeds = feeds.filter((f) => f.kind === "PROVIDER");
  const employerFeeds = feeds.filter((f) => f.kind === "EMPLOYER");
  const employerProviders = providers.filter((p) => p.perEmployer);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Opportunity Intelligence"
        title="Sources & settings"
        description="Every integration with its real status, access requirements, coverage and limitations. Credentials live only in server environment variables — this page shows variable names, never values. Missing credentials leave a source off; nothing is simulated."
      />

      <section aria-labelledby="providers" className="space-y-3">
        <h2 id="providers" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          National & regional sources
        </h2>
        <ul className="grid gap-4 xl:grid-cols-2">
          {providerFeeds.map((f) => {
            const p = providers.find((x) => x.id === f.providerId)!;
            return (
              <li key={f.id} className="rounded-2xl border border-ink-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-ink-900">{p.name}</h3>
                    <p className="text-sm text-ink-600">
                      {p.publisher} · {OPPORTUNITY_TYPE_LABELS[p.type]} · {SOURCE_CLASS_LABELS[p.defaultSourceClass]}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <ProviderStateBadge state={f.state} />
                    <Badge tone={p.evidence === "REAL_DATA_TESTED" ? "success" : "neutral"}>{p.evidence === "REAL_DATA_TESTED" ? "Tested with real data" : "Built from docs · not yet tested"}</Badge>
                  </div>
                </div>
                {f.stateMessage && f.state !== "OPERATIONAL" && <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{f.stateMessage}</p>}
                <p className="mt-3 text-sm text-ink-600">{p.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  <span className="font-medium text-ink-600">Limitations:</span> {p.limitations}
                </p>

                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {p.coverage.map((c) => (
                    <li key={c.code} title={c.note}>
                      <Badge tone={c.level === "NATIONAL_OFFICIAL" ? "brand" : "neutral"}>
                        {getOpportunityCountry(c.code)?.flag} {c.code} · {COVERAGE_LABELS[c.level]}
                      </Badge>
                    </li>
                  ))}
                </ul>

                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  {CAPS.map(([k, label]) => {
                    const on = k === "activityCheck" ? p.hasActivityCheck : !!(p.capabilities as Record<string, unknown>)[k];
                    return (
                      <li key={k} className={on ? "flex items-center gap-1.5 text-ink-800" : "flex items-center gap-1.5 text-ink-400"}>
                        {on ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
                        {label}
                        <span className="sr-only">{on ? "available" : "not available"}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-ink-500">
                  {REMOVAL[p.capabilities.removalDetection]} · {p.freshnessNote} · Webhooks: not offered.
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-500">Last successful sync</dt>
                    <dd>{f.health?.lastSuccessAt ? formatAge(f.health.lastSuccessAt) : "Never"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-500">Schedule</dt>
                    <dd>{f.enabled ? formatInterval(f.intervalMinutes) : "Off"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-500">Stored records</dt>
                    <dd className="tabular-nums">{f.records.toLocaleString("en-GB")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-500">Last error</dt>
                    <dd className="text-xs text-red-700">{f.health?.lastError ?? "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-ink-500">Access</dt>
                    <dd className="text-xs text-ink-700">
                      {p.access.termsNote}
                      {p.access.requiredEnv.length > 0 && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {p.access.requiredEnv.map((e) => (
                            <code key={e} className="rounded bg-ink-100 px-1.5 py-0.5">
                              {e}
                            </code>
                          ))}
                          <span className={p.configured.ok ? "text-emerald-700" : "text-amber-700"}>{p.configured.ok ? "set on server" : `not set: ${p.configured.missing.join(", ")}`}</span>
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <FeedControls id={f.id} enabled={f.enabled} configured={p.configured.ok} requiresAgreement={p.requiresAgreement} kind="PROVIDER" />
                  <div className="flex gap-3 text-xs">
                    <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                      Documentation <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    {p.access.signupUrl && (
                      <a href={p.access.signupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Get access <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                    {p.access.termsUrl && (
                      <a href={p.access.termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Terms <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </div>
                </div>

                {(p.settingFields ?? []).length > 0 && (
                  <details className="mt-4 border-t border-ink-100 pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink-700">Scope settings</summary>
                    <div className="mt-3">
                      <FeedSettingsForm id={f.id} fields={p.settingFields ?? []} values={f.settings} intervalMinutes={f.intervalMinutes} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="employers" className="space-y-3">
        <h2 id="employers" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Employer feeds (official ATS boards & careers pages)
        </h2>
        <Alert tone="info">
          Employer feeds monitor specific companies you choose. ExploreTechify checks that each ATS board is linked from the employer&apos;s official website before labelling it a verified official source; unlinked boards are sent to the verification queue.
        </Alert>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader title={`${employerFeeds.length} employer feed${employerFeeds.length === 1 ? "" : "s"}`} />
            {employerFeeds.length ? (
              <ul className="divide-y divide-ink-100">
                {employerFeeds.map((f) => (
                  <li key={f.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{f.label}</p>
                        <p className="break-all text-xs text-ink-500">
                          {String(f.config.token ?? f.config.careersUrl ?? "")} · {String(f.config.employerWebsite ?? "")}
                        </p>
                      </div>
                      <ProviderStateBadge state={f.state} />
                    </div>
                    <p className="text-xs text-ink-600">
                      Verification: {VERIFY_TEXT[f.verification?.status ?? "NOT_CHECKED"]}
                      {f.verification?.checkedAt ? ` · checked ${formatAge(f.verification.checkedAt)}` : ""}
                    </p>
                    {f.verification?.detail && <p className="text-xs text-ink-500">{f.verification.detail}</p>}
                    <p className="text-xs text-ink-500">
                      {f.records} records · last success {f.health?.lastSuccessAt ? formatAge(f.health.lastSuccessAt) : "never"}
                      {f.health?.lastError ? ` · last error: ${f.health.lastError}` : ""}
                    </p>
                    <FeedControls id={f.id} enabled={f.enabled} configured kind="EMPLOYER" canVerify={f.providerId !== "careers-page"} />
                  </li>
                ))}
              </ul>
            ) : (
              <CardContent>
                <p className="text-sm text-ink-500">No employer feeds yet. Add an employer whose own ATS board or careers page you want to monitor.</p>
              </CardContent>
            )}
          </Card>
          <Card>
            <CardHeader title="Add employer feed" description="Greenhouse, Lever and Ashby public boards, or a careers page on the employer's own domain (schema.org JobPosting data)." />
            <CardContent>
              <AddEmployerFeed providers={employerProviders.map((p) => ({ id: p.id, name: p.name, fields: p.feedConfigFields ?? [] }))} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="candidates" className="space-y-3">
        <h2 id="candidates" className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Evaluated but not integrated
        </h2>
        <Card>
          <ul className="divide-y divide-ink-100">
            {CANDIDATE_SOURCES.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 max-w-3xl">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 hover:underline">
                    {s.name}
                  </a>
                  <p className="text-xs text-ink-600">{s.reason}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ink-500">
                    {OPPORTUNITY_TYPE_LABELS[s.type]} · {s.countries.join(", ")}
                  </span>
                  <ProviderStateBadge state={s.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
