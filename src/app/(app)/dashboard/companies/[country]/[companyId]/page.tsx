import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Minus, ShieldAlert, X } from "lucide-react";
import { getCountry } from "@/config/countries";
import { profileForIndustry } from "@/config/industries";
import { absoluteUrl } from "@/config/site";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { CONTACT_OWNERSHIP_LABELS, EMAIL_VERIFICATION_LABELS, PHONE_VERIFICATION_LABELS, RESEARCH_STATUS_LABELS, type ContactOwnership, type ContactSourceKind, type EligibilityState, type EmailVerification, type PhoneVerification, type ResearchStatus } from "@/lib/company-fields";
import { formatDay } from "@/lib/dates/country-time";
import { formatDate, formatDateTime, formatRelative } from "@/lib/utils/format";
import { getMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { getCompanyDetail } from "@/features/companies/service";
import { toCompanyRow } from "@/features/companies/rows";
import { listInternalUsers } from "@/features/crm/service";
import { listTemplates } from "@/features/outreach/service";
import { getCountryView } from "@/features/countries/service";
import { ensurePeople } from "@/features/registry/refresh";
import { DATA_FRESHNESS_LABELS, SOURCE_TYPE_LABELS, type DataFreshness, type SourceType } from "@/features/registry/types";
import { isAiEnabled } from "@/features/ai";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ScorePill } from "@/components/ui/data";
import { ActivityComposer, FollowUpDone, FollowUpScheduler, IntelligenceActions, LeadControls } from "@/components/app/company-actions";
import { ContactValue, CopyButton, SourceTag } from "@/components/intel/contact-value";
import { CompletenessStars, ContactChecklist, FreshnessBadge } from "@/components/intel/quality";
import { QualifyButtons } from "@/components/intel/qualify-buttons";
import { ResearchActions } from "@/components/intel/research-actions";
import { ContactLogForm, ContactReviewButtons, EligibilityForm, QuotationCreator, ServiceFitSuggestions } from "@/components/intel/lead-workflow";
import { listPackages } from "@/features/service-fit/service";
import { eligibleRecipients, listQuotations } from "@/features/quotations/service";

export const metadata = { title: "Company Intelligence Profile" };

function Check3({ value }: { value?: boolean | null }) {
  if (value === undefined || value === null) return <Minus className="h-4 w-4 text-ink-300" aria-label="Unknown" />;
  return value ? <Check className="h-4 w-4 text-emerald-600" aria-label="Yes" /> : <X className="h-4 w-4 text-red-500" aria-label="No" />;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{children ?? <span className="italic text-ink-400">Not available from source</span>}</dd>
    </div>
  );
}

export default async function CompanyProfilePage({ params }: { params: Promise<{ country: string; companyId: string }> }) {
  const actor = await requireInternalPage("companies.read");
  const { companyId } = await params;
  let detail;
  try {
    detail = await getCompanyDetail(actor, companyId);
  } catch {
    notFound();
  }
  // Load registry roles on first view (best effort, short timeout).
  if (await ensurePeople(detail.company)) detail = await getCompanyDetail(actor, companyId);
  const { company: c, contacts, activities, followUps, emails, latestAudit, assignee, canManage, canEdit, canResearch, neighbors } = detail;
  const [users, templates, en, countryView, packages, quotations, recipients] = await Promise.all([
    listInternalUsers(),
    can(actor, "outreach.manage") ? listTemplates(actor, { country: c.countryCode }) : Promise.resolve([]),
    getMessages("en"),
    getCountryView(c.countryCode),
    listPackages(),
    listQuotations(actor, { companyId: String(c._id) }),
    eligibleRecipients(c),
  ]);
  const country = getCountry(c.countryCode);
  const row = toCompanyRow(c);
  const caps = countryView?.provider?.capabilities;
  const missing = (supported: boolean | undefined) => (c.enrichment?.lastRunAt ? "Not found in registry or on website" : supported === false ? "Not published by this registry" : "Not available from registry");
  const profile = profileForIndustry(c.industry ?? undefined, c.signals?.hiring ?? false);
  const listHref = `/dashboard/companies/${c.countryCode.toLowerCase()}${c.registrationDay ? `?range=custom&from=${c.registrationDay}&to=${c.registrationDay}` : ""}`;
  const base = `/dashboard/companies/${c.countryCode.toLowerCase()}`;
  const fullAddress = [c.address, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      {/* Navigation through the day's list */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={listHref} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {country?.name} · registered {c.registrationDay ? formatDay(c.registrationDay, { day: "numeric", month: "short" }) : "—"}
        </Link>
        {neighbors.total ? (
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-ink-500">
              {neighbors.position} of {neighbors.total} registered that day
            </span>
            {neighbors.prev ? (
              <Link href={`${base}/${neighbors.prev.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:bg-ink-50" title={neighbors.prev.name}>
                <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-100 px-2.5 text-xs text-ink-300">
                <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
              </span>
            )}
            {neighbors.next ? (
              <Link href={`${base}/${neighbors.next.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 text-xs font-medium text-ink-700 hover:bg-ink-50" title={neighbors.next.name}>
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-ink-100 px-2.5 text-xs text-ink-300">
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Header */}
      <header className="rounded-2xl border border-ink-200 bg-white p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Company Intelligence Profile</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">{c.companyName}</h1>
          {c.status && <Badge tone={c.status === "Active" ? "success" : "neutral"}>{c.status.toUpperCase()}</Badge>}
          {c.isDemo && <Badge tone="demo">DEMO DATA</Badge>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs text-ink-500">{country?.registrationNumberLabel ?? "Registration number"}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium tabular-nums text-ink-900">
              {c.registrationNumber ?? "—"} {c.registrationNumber && <CopyButton value={c.registrationNumber} label="registration number" />}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Registered</dt>
            <dd className="mt-0.5 text-base font-semibold text-ink-900">{c.registrationDay ? formatDay(c.registrationDay) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Country</dt>
            <dd className="mt-0.5 text-sm text-ink-900">
              <span aria-hidden>{country?.flag}</span> {country?.name}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-500">Industry</dt>
            <dd className="mt-0.5 text-sm text-ink-900">
              {row.industryLabel}
              {c.industryCode && <span className="text-ink-500"> · {c.industryCode}</span>}
            </dd>
          </div>
        </dl>
        {c.marketingProtected && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> The registry marks this company as protected from marketing (e.g. Danish reklamebeskyttelse). Do not send marketing.
          </p>
        )}

        {/* CONTACT — the most important block */}
        <div className="mt-5 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-700">Contact</h2>
            <ResearchActions
              companyId={String(c._id)}
              canRefresh={!!countryView?.provider?.capabilities.supportsLookup}
              canFind={canResearch}
              canEdit={canEdit}
              isDemo={!!c.isDemo}
              current={{ email: c.email ?? undefined, phone: c.phone ?? undefined, mobile: c.mobile ?? undefined, website: c.website ?? undefined, contactPersonName: c.contactPerson?.name ?? undefined, contactPersonRole: c.contactPerson?.role ?? undefined }}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <ContactValue kind="email" showLabel value={row.email} sourceKind={row.sources.email?.kind} source={row.sources.email?.source} missing={missing(caps?.supportsEmail)} disabledActions={row.isDemo} />
            <ContactValue kind="phone" showLabel value={row.phone} sourceKind={row.sources.phone?.kind} source={row.sources.phone?.source} missing={missing(caps?.supportsPhone)} disabledActions={row.isDemo} />
            <ContactValue kind="mobile" showLabel value={row.mobile} sourceKind={row.sources.mobile?.kind} source={row.sources.mobile?.source} missing={missing(caps?.supportsMobile)} disabledActions={row.isDemo} />
            <ContactValue kind="website" showLabel value={row.website} sourceKind={row.sources.website?.kind} source={row.sources.website?.source} missing={missing(caps?.supportsWebsite)} disabledActions={row.isDemo} />
            <ContactValue kind="person" showLabel value={row.contactPerson?.name} secondary={row.contactPerson?.role} sourceKind={row.sources.contactPerson?.kind} source={row.sources.contactPerson?.source} missing={caps?.supportsRoles ? "No contact role registered" : "Not published by this registry"} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-100 pt-3">
            <div className="flex flex-wrap items-center gap-4">
              <CompletenessStars value={c.completeness ?? 0} />
              <ContactChecklist flags={row.flags} className="!grid-cols-3 sm:!grid-cols-6" />
            </div>
            <QualifyButtons companyId={String(c._id)} relevance={row.relevance} saved={row.saved} stage={row.stage} canQualify={canManage} size="md" />
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Registration" />
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Registration date">{c.registrationDay ? <strong>{formatDay(c.registrationDay)}</strong> : null}</Field>
                  <Field label="Founding / incorporation date">{c.incorporationDate ? formatDate(c.incorporationDate) : null}</Field>
                  <Field label="Status">{c.status}</Field>
                  <Field label="Legal form">{c.legalForm ? `${c.legalForm}${c.legalFormCode && c.legalFormCode !== c.legalForm ? ` (${c.legalFormCode})` : ""}` : null}</Field>
                  <Field label={country?.registrationNumberLabel ?? "Registration number"}>{c.registrationNumber}</Field>
                  <Field label="Industry code">{c.industryCode ? `${c.industryCode}${c.industryCodeSystem ? ` · ${c.industryCodeSystem}` : ""}` : null}</Field>
                  <Field label="Source registry">{c.sourceName ?? countryView?.registryName}</Field>
                  {c.employees !== undefined && c.employees !== null && <Field label="Registered employees">{c.employees}</Field>}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Address" />
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Business address" wide>
                    {fullAddress ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {fullAddress} <CopyButton value={fullAddress} label="address" />
                      </span>
                    ) : null}
                  </Field>
                  <Field label="Postal address" wide>
                    {c.postalAddress}
                  </Field>
                  <Field label="City">{c.city}</Field>
                  <Field label="Postal code">{c.postalCode}</Field>
                  <Field label="Municipality / region">{c.region}</Field>
                  <Field label="Country">{country?.name}</Field>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader title="Business description" description="What the company says it does — useful for judging relevance." />
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3">
                <Field label="Industry">{row.industryLabel}</Field>
                <Field label="Business activity">{c.businessActivity}</Field>
                <Field label="Company purpose (articles of association)">{c.companyPurpose}</Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="People & roles" description={caps?.supportsRoles ? `As registered with ${c.sourceName}. Birth dates and other personal details are not stored.` : "This registry does not publish roles through the connected API."} />
            {c.people?.length ? (
              <ul className="divide-y divide-ink-100">
                {c.people.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="font-medium text-ink-900">{p.name}</span>
                    <span className="text-right text-ink-600">
                      {p.role}
                      {p.group && p.group !== p.role && <span className="block text-xs text-ink-400">{p.group}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardContent>
                <p className="text-sm italic text-ink-400">{caps?.supportsRoles ? (c.peopleFetchedAt ? "No active roles registered." : "Roles could not be loaded right now — use “Refresh from registry”.") : "Not available from this source."}</p>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader title="Contact evidence" description="Every value with its source, ownership and verification. Only owned, usable email/phone values count as direct contacts; ambiguous ones wait for review." />
            <ul className="divide-y divide-ink-100">
              {contacts.map((k) => (
                <li key={String(k._id)} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="mr-2 text-xs uppercase tracking-wide text-ink-400">{k.type.replace("_", " ").toLowerCase()}</span>
                      <span className="break-all font-medium text-ink-900">{k.value}</span>
                      {(k.personName || k.role) && <span className="text-ink-500"> · {[k.personName, k.role].filter(Boolean).join(", ")}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs">
                      <SourceTag kind={k.sourceKind as ContactSourceKind} source={k.source} />
                      {k.ownership && k.ownership !== "CONFIRMED" && <Badge tone={k.ownership === "INTERMEDIARY" ? "danger" : k.ownership === "UNCERTAIN" ? "warning" : "neutral"}>{CONTACT_OWNERSHIP_LABELS[k.ownership as ContactOwnership]}</Badge>}
                      {k.emailVerification && <Badge tone={k.emailVerification === "DELIVERABLE" ? "success" : k.emailVerification === "INVALID" || k.emailVerification === "BOUNCED" ? "danger" : "neutral"}>{EMAIL_VERIFICATION_LABELS[k.emailVerification as EmailVerification]}</Badge>}
                      {k.phoneVerification && <Badge tone="neutral">{PHONE_VERIFICATION_LABELS[k.phoneVerification as PhoneVerification]}</Badge>}
                      {!k.usable && <Badge tone="warning">Not usable: {k.unusableReason}</Badge>}
                      {k.review === "PENDING" && <Badge tone="warning">Needs review</Badge>}
                      {k.review === "REJECTED" && <Badge tone="neutral">Rejected</Badge>}
                      <ContactReviewButtons contactId={String(k._id)} review={k.review ?? "NONE"} />
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {k.source}
                    {k.collectedAt && ` · collected ${formatDateTime(k.collectedAt)}`}
                    {k.sourceUrl && (
                      <>
                        {" · "}
                        <a href={k.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:underline">
                          source page
                        </a>
                      </>
                    )}
                  </p>
                  {k.evidence?.length ? <p className="mt-0.5 text-xs text-ink-500">Evidence: {k.evidence[k.evidence.length - 1]!.detail}</p> : null}
                </li>
              ))}
              {contacts.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No contact values on record yet. Research runs automatically; use “Find contact details” to run it now.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Contact research" description="Bounded, source-attributed research: registry → official website → approved providers → verification." />
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-ink-900">{RESEARCH_STATUS_LABELS[(c.research?.status ?? "NOT_STARTED") as ResearchStatus]}</span>
                <span className="text-ink-500">
                  {" "}
                  · {c.research?.attempts ?? 0} attempt(s){c.research?.lastAttemptAt ? `, last ${formatRelative(c.research.lastAttemptAt)}` : ""}
                  {c.research?.nextRetryAt ? ` · next retry ${formatDate(c.research.nextRetryAt)}` : ""}
                  {c.research?.costCents ? ` · provider cost ${(c.research.costCents / 100).toFixed(2)}` : ""}
                </span>
              </p>
              {c.contactFoundAt && <p className="text-xs text-ink-500">First direct contact found {formatDateTime(c.contactFoundAt)} (registered {c.registrationDay ?? "—"} — the registration date is not changed by research).</p>}
              <ul className="space-y-1 text-xs text-ink-600">
                {(c.research?.checkedSources ?? []).slice(-8).reverse().map((x, i) => (
                  <li key={i}>
                    <span className="font-medium">{x.source}</span> — {x.outcome}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Service fit" description="Evidence-based suggestions — separate from contact quality and registration data. Accept, reject or edit each." action={<span className="text-sm font-semibold tabular-nums">{c.serviceFit?.score ?? 0}</span>} />
            <CardContent>
              <ServiceFitSuggestions companyId={String(c._id)} suggestions={(c.serviceFit?.suggestions ?? []).map((x) => ({ packageId: String(x.packageId), packageName: x.packageName ?? "", observation: x.observation ?? "", source: x.source ?? "", confidence: x.confidence ?? "low", nextQuestion: x.nextQuestion ?? undefined, status: x.status ?? "SUGGESTED", note: x.note ?? undefined }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Record manual contact" description="Channel, date, response and next action — nothing is sent from here." />
            <CardContent>
              <ContactLogForm companyId={String(c._id)} phoneOnly={!!c.directContact?.hasPhone && !c.directContact?.hasEmail} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Website audit" description={latestAudit ? `Checked ${formatDateTime(latestAudit.checkedAt)}${latestAudit.isDemo ? " · demo audit (simulated)" : ""}` : "Run an audit to check HTTPS, mobile-friendliness, SEO basics and broken links (robots.txt is respected)."} action={latestAudit?.score != null ? <ScorePill score={latestAudit.score} threshold={70} /> : null} />
            {latestAudit && (
              <CardContent>
                {latestAudit.error ? (
                  <p className="text-sm text-red-600">{latestAudit.error}</p>
                ) : (
                  <div className="grid gap-6 md:grid-cols-2">
                    <ul className="space-y-2 text-sm">
                      {[
                        ["HTTPS", latestAudit.https],
                        ["Mobile-friendly", latestAudit.mobileFriendly],
                        ["Meta title", !!latestAudit.title],
                        ["Meta description", !!latestAudit.metaDescription],
                        ["Open Graph", latestAudit.hasOpenGraph],
                        ["Contact information", latestAudit.hasContactInfo],
                      ].map(([label, v]) => (
                        <li key={label as string} className="flex items-center justify-between">
                          <span className="text-ink-700">{label as string}</span>
                          <Check3 value={v as boolean | undefined} />
                        </li>
                      ))}
                    </ul>
                    <div>
                      <p className="text-xs font-medium text-ink-500">Issues found</p>
                      <ul className="mt-2 space-y-1.5 text-sm text-ink-700">{latestAudit.issues.length ? latestAudit.issues.map((i) => <li key={i}>• {i}</li>) : <li>No issues found.</li>}</ul>
                      {latestAudit.technologies.length > 0 && <p className="mt-4 text-xs text-ink-500">Detected: {latestAudit.technologies.join(", ")}</p>}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity & notes" description="Research and CRM history" />
            <CardContent className="space-y-4">
              {canManage && <ActivityComposer companyId={String(c._id)} />}
              <ol className="space-y-3">
                {activities.map((a) => (
                  <li key={String(a._id)} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-300" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink-800">
                        <span className="font-medium">{a.actorId?.name ?? "System"}</span> <span className="text-ink-500">· {a.type.replace(/_/g, " ").toLowerCase()}</span>
                        {a.type === "STAGE_CHANGE" && a.meta && (
                          <span className="text-ink-500">
                            {" "}
                            {String((a.meta as { from?: string }).from ?? "").toLowerCase()} → {String((a.meta as { to?: string }).to ?? "").toLowerCase()}
                          </span>
                        )}
                      </p>
                      {a.body && <p className="mt-0.5 whitespace-pre-line text-ink-600">{a.body}</p>}
                    </div>
                    <time className="shrink-0 text-xs text-ink-400" dateTime={new Date(a.createdAt).toISOString()}>
                      {formatRelative(a.createdAt)}
                    </time>
                  </li>
                ))}
                {activities.length === 0 && <li className="text-sm text-ink-500">No activity yet.</li>}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Email history" />
            <ul className="divide-y divide-ink-100">
              {emails.map((m) => (
                <li key={String(m._id)} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <Link href={`/dashboard/outreach/messages/${m._id}`} className="min-w-0 flex-1 truncate font-medium text-ink-900 hover:text-brand-700">
                    {m.subject}
                  </Link>
                  {m.replyStatus === "REPLIED" && <Badge tone="violet">Replied</Badge>}
                  <StatusBadge status={m.status} />
                  <span className="text-xs text-ink-400">{formatDate(m.sentAt ?? m.createdAt)}</span>
                </li>
              ))}
              {emails.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No outreach emails yet.</li>}
            </ul>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Source" />
            <CardContent className="space-y-3 text-sm">
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-ink-500">Source</dt>
                  <dd className="font-medium text-ink-900">{c.sourceName ?? c.source}</dd>
                  {c.sourceType && <dd className="text-xs text-ink-500">{SOURCE_TYPE_LABELS[c.sourceType as SourceType]}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Data freshness</dt>
                  <dd className="mt-0.5">
                    <FreshnessBadge freshness={c.dataFreshness} /> <span className="sr-only">{DATA_FRESHNESS_LABELS[(c.dataFreshness ?? "UNKNOWN") as DataFreshness]}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Last fetched</dt>
                  <dd>{c.sourceFetchedAt ? `${formatDateTime(c.sourceFetchedAt)} (${formatRelative(c.sourceFetchedAt)})` : "—"}</dd>
                </div>
                {c.sourceUpdatedAt && (
                  <div>
                    <dt className="text-xs text-ink-500">Updated at source</dt>
                    <dd>{formatDateTime(c.sourceUpdatedAt)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-ink-500">Imported</dt>
                  <dd>{formatDateTime(c.createdAt)}</dd>
                </div>
              </dl>
              {c.sourceUrl && !c.isDemo ? (
                <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  View official registry record <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <p className="text-xs text-ink-400">{c.isDemo ? "Demo record — no official source." : "This source does not provide a public record link."}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Outreach eligibility" />
            <CardContent>
              <EligibilityForm companyId={String(c._id)} status={(c.eligibility?.status ?? "NEEDS_REVIEW") as EligibilityState} reason={c.eligibility?.reason ?? undefined} at={c.eligibility?.at ? new Date(c.eligibility.at).toISOString() : undefined} protectedBySource={!!c.marketingProtected} canEdit={canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Quotations" />
            <CardContent>
              <QuotationCreator
                companyId={String(c._id)}
                packages={packages.filter((p) => p.active).map((p) => ({ id: String(p._id), name: p.name }))}
                recipients={recipients.map((r) => ({ id: String(r._id), label: `${r.type === "EMAIL" ? "Email" : "Phone"}: ${r.value}${r.personName ? ` (${r.personName})` : ""}` }))}
                eligible={c.eligibility?.status === "CLEARED"}
                quotations={quotations.map((q) => ({ id: String(q._id), number: q.number, title: q.title, status: q.status }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="CRM" />
            <CardContent className="space-y-4">
              <LeadControls companyId={String(c._id)} stage={c.lead?.stage ?? "NEW"} assignedTo={c.lead?.assignedTo ? String(c.lead.assignedTo) : undefined} users={users.map((u) => ({ id: String(u._id), name: u.name }))} canAssign={can(actor, "leads.manage")} canManage={canManage} />
              <dl className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-500">Assigned</dt>
                  <dd>{assignee?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-500">Last contact</dt>
                  <dd>{c.lead?.lastContactedAt ? formatRelative(c.lead.lastContactedAt) : "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-ink-500">Next follow-up</dt>
                  <dd>{c.lead?.nextFollowUpAt ? formatDateTime(c.lead.nextFollowUpAt) : "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Lead score" description="Secondary to the data above — transparent and configurable." />
            <CardContent className="space-y-3">
              <ul className="space-y-1.5 text-sm">
                {(c.lead?.scoreBreakdown ?? []).map((b) => (
                  <li key={b.ruleId} className="flex justify-between">
                    <span className="text-ink-700">{b.label}</span>
                    <span className="font-medium tabular-nums text-emerald-700">
                      {b.points! > 0 ? "+" : ""}
                      {b.points}
                    </span>
                  </li>
                ))}
                {!c.lead?.scoreBreakdown?.length && <li className="text-ink-500">No scoring rules matched.</li>}
                <li className="flex justify-between border-t border-ink-100 pt-1.5 font-semibold">
                  <span>Score</span>
                  <span className="tabular-nums">{c.lead?.score ?? 0}</span>
                </li>
              </ul>
              <div className="border-t border-ink-100 pt-3">
                <p className="text-xs font-medium text-ink-500">Suggested services ({(getPath(en, `home.industries.profiles.${profile.key}.title`) as string) ?? profile.key})</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {profile.items.map((i) => (
                    <li key={i} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800">
                      {getPath(en, `serviceItems.${i}`) as string}
                    </li>
                  ))}
                </ul>
              </div>
              {!isAiEnabled() && <p className="text-xs text-ink-400">AI assistance is not configured — suggestions are rule-based from stored facts.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Follow-ups & tasks" action={canManage ? <FollowUpScheduler companyId={String(c._id)} /> : null} />
            <ul className="divide-y divide-ink-100">
              {followUps.map((f) => (
                <li key={String(f._id)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className={f.status === "OPEN" && new Date(f.dueAt) < new Date() ? "font-medium text-red-600" : "font-medium"}>
                      {formatDateTime(f.dueAt)} · {f.type.toLowerCase()}
                    </p>
                    <p className="truncate text-xs text-ink-500">
                      {f.assignedTo?.name ?? "Unassigned"}
                      {f.notes ? ` · ${f.notes}` : ""}
                    </p>
                  </div>
                  {f.status === "OPEN" ? canManage && <FollowUpDone id={String(f._id)} /> : <StatusBadge status={f.status} />}
                </li>
              ))}
              {followUps.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No follow-ups scheduled.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="More actions" />
            <CardContent>
              <IntelligenceActions
                companyId={String(c._id)}
                hasWebsite={!!c.website}
                hasEmail={!!c.email && !c.marketingProtected}
                canEdit={canEdit}
                canConvert={can(actor, "clients.manage")}
                isClient={c.lead?.stage === "CLIENT"}
                prospect={c.prospectPage?.token ? { enabled: !!c.prospectPage.enabled, url: absoluteUrl(`/explore/${c.prospectPage.token}`) } : { enabled: false }}
                templates={templates.filter((t) => t.active).map((t) => ({ id: String(t._id), label: `${t.name} (${t.countryCode} · ${t.languageCode})` }))}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
