import { ownerMetadata } from "@/features/opportunities/metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getOpportunityDetail } from "@/features/opportunities/service";
import {
  CONTACT_ROUTE_LABELS,
  EMPLOYER_IDENTITY_LABELS,
  MANUAL_VERIFICATION_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  SERVICE_CATEGORY_LABELS,
  SOURCE_CLASS_HELP,
  SOURCE_CLASS_LABELS,
  type ContactRoute,
  type EmployerIdentity,
  type ManualVerificationResult,
  type ServiceCategory,
  type SourceClass,
} from "@/features/opportunities/constants";
import { formatAge, formatInZone, zoneFor } from "@/features/opportunities/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/feedback";
import { ActivityBadge, CountryTag, VerificationBadges } from "@/components/opportunities/badges";
import { OpportunityActions, OpportunityNotes, ManualVerificationForm } from "@/components/opportunities/detail-actions";
import { cn } from "@/lib/utils";

export const generateMetadata = ownerMetadata("Opportunity");

const REMOVAL_TEXT: Record<string, string> = {
  EXPLICIT: "The source explicitly reports removals; ExploreTechify applies them on every sync.",
  LISTING_DIFF: "The source lists all current postings; a posting absent from two consecutive complete listings is checked and then marked removed.",
  DEADLINE_ONLY: "The source does not report closure. Activity follows the published deadline (and the source's status endpoint where one exists).",
  NONE: "The source offers no reliable way to confirm whether the posting is still open.",
};

const SV_TEXT: Record<string, string> = {
  AUTHORITATIVE_SOURCE: "Authoritative source (official API of the publishing authority)",
  LINKED_FROM_OFFICIAL_DOMAIN: "ATS board linked from the employer's official website",
  ON_OFFICIAL_DOMAIN: "Published on the employer's official domain",
  LINK_NOT_FOUND: "ATS board NOT linked from the employer's official website",
  NOT_CHECKED: "Publisher not yet verified",
  AGGREGATOR: "Aggregator — original posting not established",
};

function Row({ label, children, stacked }: { label: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={cn("grid gap-0.5 py-2", !stacked && "sm:grid-cols-[200px_1fr] sm:gap-4")}>
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-ink-800">{children}</dd>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getOpportunityDetail>>;
  try {
    data = await getOpportunityDetail(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const { opportunity: o, duplicates, events, company, feed, provider } = data;
  const tz = zoneFor(o.countryCode);
  const plain = JSON.parse(JSON.stringify(o)) as { _id: string; saved?: boolean; reviewStatus?: string; notes?: { _id: string; text: string; at: string }[]; manualVerification?: { result?: string; note?: string } };

  return (
    <div className="space-y-5">
      <Link href={o.type === "HIRING" ? "/dashboard/opportunities/hiring" : "/dashboard/opportunities/procurement"} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {OPPORTUNITY_TYPE_LABELS[o.type]}
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {OPPORTUNITY_TYPE_LABELS[o.type]}
              {o.noticeKind ? ` · ${o.noticeKind}` : ""}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{o.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
              <span className="font-medium text-ink-800">{o.organization?.name ?? "Organization not published by the source"}</span>
              <CountryTag code={o.countryCode} />
              {o.location && <span>{o.location}</span>}
            </p>
          </div>
          <OpportunityActions id={plain._id} saved={!!plain.saved} reviewStatus={plain.reviewStatus ?? "NEW"} hasCheck={!!provider?.hasActivityCheck} canCrm={!!o.companyLink?.companyId} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivityBadge activity={o.activity} />
          <VerificationBadges labels={o.labels ?? []} />
        </div>
        {o.contentPurged && <Alert tone="info">This posting was removed at its source. Its content was purged as the source&apos;s terms require; only identifiers and history remain.</Alert>}
        {o.archivedAt && <Alert tone="info">Archived {formatInZone(o.archivedAt, tz, false)} (closed or expired for more than 30 days).</Alert>}
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Description" description={o.summary ? "As published by the source (summary, may be truncated)." : undefined} />
            <CardContent>{o.summary ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{o.summary}</p> : <p className="text-sm text-ink-500">No description available from the source.</p>}</CardContent>
          </Card>

          <Card>
            <CardHeader title="Source & links" />
            <CardContent>
              <dl className="divide-y divide-ink-100">
                <Row label="Publisher">{o.sourcePublisher}</Row>
                <Row label="Source type">
                  {SOURCE_CLASS_LABELS[o.sourceClass as SourceClass]}
                  <span className="block text-xs text-ink-500">{SOURCE_CLASS_HELP[o.sourceClass as SourceClass]}</span>
                </Row>
                <Row label="Original source">
                  {o.sourceUrl ? (
                    <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-brand-700 hover:underline">
                      {o.sourceUrl} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    "Not provided"
                  )}
                </Row>
                <Row label={o.type === "PROCUREMENT" ? "Submission / tender documents" : "Application link"}>
                  {o.applyUrl ? (
                    <a href={o.applyUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-brand-700 hover:underline">
                      {o.applyUrl} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    "No direct link published"
                  )}
                </Row>
                <Row label="Contact routes">{(o.contactRoutes ?? []).map((r) => CONTACT_ROUTE_LABELS[r as ContactRoute]).join(" · ")}</Row>
                <Row label="Provider">
                  {provider?.name ?? o.providerId}
                  {feed?.kind === "EMPLOYER" && <span className="block text-xs text-ink-500">Employer feed: {feed.label}</span>}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Timestamps" description={`Shown in ${tz}. Source dates are never filled in when the source does not publish them.`} />
            <CardContent>
              <dl className="divide-y divide-ink-100">
                <Row label="Published (source)">{o.publishedAt ? formatInZone(o.publishedAt, tz) : "Not published by the source"}</Row>
                <Row label="Updated (source)">{o.sourceUpdatedAt ? formatInZone(o.sourceUpdatedAt, tz) : provider?.capabilities.updatedAt ? "Not given for this record" : "This source does not publish update times"}</Row>
                <Row label="First discovered (ExploreTechify)">{formatInZone(o.firstSeenAt, tz)}</Row>
                <Row label="Last confirmed at source">{o.lastSeenAt ? `${formatInZone(o.lastSeenAt, tz)} (${formatAge(o.lastSeenAt)})` : "Never"}</Row>
                <Row label="Last check">
                  {o.lastCheckedAt ? formatInZone(o.lastCheckedAt, tz) : "—"}
                  {o.lastCheckResult && <span className="block text-xs text-ink-500">{o.lastCheckResult}</span>}
                </Row>
                {o.nextCheckAt && <Row label="Next scheduled check">{formatInZone(o.nextCheckAt, tz)}</Row>}
                <Row label={o.type === "PROCUREMENT" ? "Tender deadline" : "Application deadline"}>{o.deadline ? `${formatInZone(o.deadline, tz)}${o.deadlineText ? ` (published as “${o.deadlineText}”)` : ""}` : o.deadlineText ? `“${o.deadlineText}” (as published — not a date)` : "Not published by the source"}</Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Verification evidence" description="Each dimension is assessed separately." />
            <CardContent className="space-y-4">
              <dl className="divide-y divide-ink-100">
                <Row label="Source verification">
                  {SV_TEXT[o.sourceVerification?.status ?? "NOT_CHECKED"]}
                  {o.sourceVerification?.detail && <span className="block text-xs text-ink-500">{o.sourceVerification.detail}</span>}
                  {o.sourceVerification?.url && (
                    <a href={o.sourceVerification.url} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-xs text-brand-700 hover:underline">
                      {o.sourceVerification.url}
                    </a>
                  )}
                </Row>
                <Row label="Employer / buyer identity">{EMPLOYER_IDENTITY_LABELS[o.employerIdentity as EmployerIdentity]}</Row>
                <Row label="Activity">
                  <ActivityBadge activity={o.activity} />
                  {provider && <span className="mt-1 block text-xs text-ink-500">{REMOVAL_TEXT[provider.capabilities.removalDetection]}</span>}
                </Row>
                <Row label="Owner assessment">{o.manualVerification?.result ? `${MANUAL_VERIFICATION_LABELS[o.manualVerification.result as ManualVerificationResult]}${o.manualVerification.at ? ` · ${formatInZone(o.manualVerification.at, tz)}` : ""}${o.manualVerification.note ? ` — ${o.manualVerification.note}` : ""}` : "Not assessed"}</Row>
              </dl>
              {(o.reviewReasons ?? []).length > 0 && (
                <Alert tone="warning" title="Why this needs review">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {o.reviewReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {provider?.limitations && (
                <p className="flex gap-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Source limitation: {provider.limitations}
                </p>
              )}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Evidence log</h3>
                {(o.evidence ?? []).length ? (
                  <ol className="space-y-2">
                    {[...o.evidence].reverse().map((e, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.result === "PASS" ? "bg-emerald-500" : e.result === "FAIL" ? "bg-red-500" : "bg-amber-400")} aria-hidden />
                        <div className="min-w-0">
                          <p className="text-ink-800">
                            <span className="font-medium">{e.kind.replace(/_/g, " ").toLowerCase()}</span> · <span className="text-xs uppercase text-ink-500">{e.result}</span>
                          </p>
                          {e.detail && <p className="text-xs text-ink-600">{e.detail}</p>}
                          <p className="text-xs text-ink-400">{formatInZone(e.at, tz)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-ink-500">No evidence recorded.</p>
                )}
              </div>
              <ManualVerificationForm id={plain._id} current={plain.manualVerification?.result} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Status & sync history" />
            {events.length ? (
              <ol className="divide-y divide-ink-100">
                {events.map((e) => (
                  <li key={String(e._id)} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-sm">
                    <span className="text-ink-800">
                      <span className="font-medium">{e.kind.replace(/_/g, " ").toLowerCase()}</span>
                      {e.from || e.to ? <span className="text-ink-500"> {e.from ?? "—"} → {e.to ?? "—"}</span> : null}
                      {e.detail && <span className="block text-xs text-ink-500">{e.detail}</span>}
                    </span>
                    <span className="text-xs text-ink-400">{formatInZone(e.at, tz)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <CardContent>
                <p className="text-sm text-ink-500">No history yet.</p>
              </CardContent>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Organization" />
            <CardContent>
              <dl className="divide-y divide-ink-100">
                <Row stacked label="Name">{o.organization?.name ?? "Not published"}</Row>
                <Row stacked label="Registration number">{o.organization?.registrationNumber ? `${o.organization.registrationNumber}${o.organization.registrationCountry ? ` (${o.organization.registrationCountry})` : ""}` : "Not published by the source"}</Row>
                <Row stacked label="Website">{o.organization?.website ? <a href={o.organization.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 hover:underline">{o.organization.website}</a> : "Not published"}</Row>
                <Row stacked label="Company Intelligence">
                  {company ? (
                    <>
                      <Link href={`/dashboard/companies/${company.countryCode.toLowerCase()}/${String(company._id)}`} className="text-brand-700 hover:underline">
                        {company.companyName}
                      </Link>
                      <span className="block text-xs text-ink-500">Matched by {o.companyLink?.method?.replace(/_/g, " ").toLowerCase()}{company.registrationDay ? ` · registered ${company.registrationDay}` : ""}</span>
                    </>
                  ) : (
                    <span className="text-ink-500">No reliable match (registration number or official domain). Companies are never matched by name.</span>
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Contacts" description="Only contacts the source published, with provenance." />
            {(o.contacts ?? []).length ? (
              <ul className="divide-y divide-ink-100">
                {o.contacts.map((c, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink-800">
                      {c.name ?? c.kind.replace(/_/g, " ").toLowerCase()}
                      {c.role && <span className="font-normal text-ink-500"> · {c.role}</span>}
                    </p>
                    {c.email && <a href={`mailto:${c.email}`} className="block break-all text-brand-700 hover:underline">{c.email}</a>}
                    {c.phone && <span className="block text-ink-700">{c.phone}</span>}
                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="block break-all text-xs text-brand-700 hover:underline">{c.url}</a>}
                    <p className="mt-1 text-xs text-ink-400">
                      Published via {c.sourceProvider}
                      {c.checkedAt ? ` · seen ${formatInZone(c.checkedAt, tz, false)}` : ""}
                      {c.thirdParty ? " · different domain from the organization (e.g. an agent)" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <CardContent>
                <p className="text-sm text-ink-500">No direct contact route found in the source.</p>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader title="Classification" />
            <CardContent className="space-y-2 text-sm">
              {o.classification?.scheme && (
                <p className="text-ink-700">
                  <span className="text-xs text-ink-500">{o.classification.scheme}: </span>
                  {(o.classification.labels?.length ? o.classification.labels : (o.classification.codes ?? [])).slice(0, 12).join(", ") || "—"}
                </p>
              )}
              {o.jobCategory && <p className="text-ink-700">{o.jobCategory}</p>}
              {o.employmentType && <p className="text-xs text-ink-500">{o.employmentType}</p>}
              <div className="flex flex-wrap gap-1">
                {(o.serviceCategories ?? []).map((c) => (
                  <span key={c} className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800">
                    {SERVICE_CATEGORY_LABELS[c as ServiceCategory]}
                  </span>
                ))}
              </div>
              <p className="text-xs text-ink-500">
                {o.serviceCategoryBasis === "PUBLISHED_CLASSIFICATION" ? "Service categories derived from the published classification codes." : o.serviceCategoryBasis === "PUBLISHED_TEXT_KEYWORDS" ? "Service categories derived from keywords in the published title — indicative only." : "No service category derived."}
              </p>
            </CardContent>
          </Card>

          {duplicates.length > 0 && (
            <Card>
              <CardHeader title="Also published at" description="Other source records of this opportunity (kept as evidence)." />
              <ul className="divide-y divide-ink-100">
                {duplicates.map((d) => (
                  <li key={String(d._id)} className="px-5 py-3 text-sm">
                    <p className="font-medium text-ink-800">{d.sourcePublisher}</p>
                    <p className="text-xs text-ink-500">
                      {SOURCE_CLASS_LABELS[d.sourceClass as SourceClass]} · matched by {d.dedupeMethod?.replace(/_/g, " ").toLowerCase()} · {d.activity.toLowerCase()}
                    </p>
                    {d.sourceUrl && (
                      <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-xs text-brand-700 hover:underline">
                        {d.sourceUrl}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <OpportunityNotes id={plain._id} notes={plain.notes ?? []} timeZone={tz} />
        </aside>
      </div>
    </div>
  );
}
