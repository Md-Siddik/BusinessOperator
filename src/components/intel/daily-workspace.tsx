import Link from "next/link";
import { AlertTriangle, BookOpen, Building2, KeyRound, PlugZap } from "lucide-react";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/config/industries";
import { DATE_PRESET_LABELS, formatDay } from "@/lib/dates/country-time";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/utils/format";
import { can, isOwner, type Actor } from "@/lib/permissions";
import { getDefaultTemplate, getSenderStatus, TEMPLATE_OPTIONS } from "@/features/email-sender/service";
import type { CompanyEmailContext } from "@/components/email-sender/company-email-actions";
import { Pagination } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ALL, COMPANY_SORTS, COMPANY_SORT_LABELS, listCompanies, type CompanyView } from "@/features/companies/service";
import { getRegistrationOverview, listCountryCards, type RegistrationOverview } from "@/features/companies/registrations";
import { getEnabledCountries, type CountryView } from "@/features/countries/service";
import { toCompanyRow } from "@/features/companies/rows";
import { activeAssignmentCounts } from "@/features/marketer/service";
import { DATA_FRESHNESS_LABELS, SOURCE_TYPE_LABELS } from "@/features/registry/types";
import { cn } from "@/lib/utils";
import { ConnectionDot, FreshnessBadge } from "./quality";
import { LiveUpdates } from "./live-updates";
import { feedDelayStats } from "@/features/registry/live";
import { hasNoFeed, needsAccess, STATE_LABELS, type UiIntegrationState } from "@/lib/integration-state";
import { RegistrationsTable } from "./registrations-table";
import { CompanyFilters, CountryDateBar, SyncControls } from "./workspace-controls";
import type { SourceCapabilities } from "./types";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export type WorkspaceMode = "daily" | "research" | "saved";

/** Quick Send / Custom email: Owner only. Same template and sender status as the Email Sender page. */
function ownerEmailContext(actor: Actor): CompanyEmailContext | undefined {
  if (!isOwner(actor)) return undefined;
  const s = getSenderStatus(actor);
  return { template: getDefaultTemplate(actor), configured: s.configured, problems: s.problems, from: s.from, fromName: s.fromName, options: TEMPLATE_OPTIONS };
}

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : "—");

function Kpi({ label, value, total, tone }: { label: string; value: number; total: number; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums", tone === "good" ? "text-emerald-700" : "text-ink-900")}>{formatNumber(value)}</span>
        <span className="text-xs tabular-nums text-ink-500">{pct(value, total)}</span>
      </p>
    </div>
  );
}

function QuickStat({ label, value, href, active }: { label: string; value: number | null; href: string; active: boolean }) {
  return (
    <Link href={href} className={cn("rounded-lg px-3 py-2 transition-colors", active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-ink-50")} aria-current={active || undefined}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</span>
      <span className="block text-lg font-semibold tabular-nums text-ink-900">{value === null ? <span className="text-sm font-normal text-ink-400">not synced</span> : formatNumber(value)}</span>
    </Link>
  );
}

/** Daily registrations bar list: one row per day, clickable to load that day. Single hue = magnitude. */
function Timeline({ data, selectedDay, hrefFor }: { data: RegistrationOverview["timeline"]; selectedDay?: string; hrefFor: (day: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.count ?? 0));
  return (
    // On lg+ the panel fills the row the summary sizes (h-0 + min-h-full adds no height of its own);
    // the day list scrolls inside it, opening at the most recent days (column-reverse anchors the end).
    <div className="rounded-2xl border border-ink-200 bg-white p-4 lg:flex lg:h-0 lg:min-h-full lg:flex-col">
      <div className="mb-3 flex shrink-0 items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink-900">Daily registrations</h2>
        <span className="text-xs text-ink-500">Last 14 days · click a day</span>
      </div>
      <div className="scroll-thin lg:flex lg:min-h-0 lg:flex-1 lg:flex-col-reverse lg:overflow-y-auto lg:p-px">
        <ol className="space-y-0.5 lg:mb-auto">
          {data.map((d) => {
            const active = d.date === selectedDay;
            return (
              <li key={d.date}>
                <Link href={hrefFor(d.date)} className={cn("grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-ink-50", active && "bg-brand-50 ring-1 ring-brand-200")} aria-current={active || undefined}>
                  <span className={cn("tabular-nums", active ? "font-semibold text-brand-800" : "text-ink-600")}>{formatDay(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="h-2.5 rounded-full bg-ink-100" aria-hidden>
                    {d.count !== null && <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(d.count ? 3 : 0, (d.count / max) * 100)}%` }} />}
                  </span>
                  <span className="text-right font-medium tabular-nums text-ink-900">{d.count === null ? <span className="font-normal text-ink-400">—</span> : formatNumber(d.count)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-2 shrink-0 text-[11px] text-ink-400">“—” = day not synced yet.</p>
    </div>
  );
}

function SourcePanel({ view, lastFetchedAt, delay }: { view: CountryView; lastFetchedAt?: Date | null; delay?: { medianSeconds: number | null; samples: number } | null }) {
  const p = view.provider;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-600">
      <span>
        <span className="text-ink-400">Data source </span>
        <span className="font-semibold text-ink-900">{p?.sourceName ?? view.registryName}</span>
        {p && <span className="text-ink-500"> · {SOURCE_TYPE_LABELS[p.sourceType]}</span>}
      </span>
      {p && <FreshnessBadge freshness={p.freshness} />}
      <ConnectionDot state={view.state} />
      {view.latestPublicationAt && (
        <span>
          <span className="text-ink-400">Latest source publication </span>
          <span className="font-medium text-ink-800">{formatDateTime(view.latestPublicationAt)}</span>
        </span>
      )}
      {delay && delay.samples > 0 && delay.medianSeconds !== null && (
        <span title={`Median of ${delay.samples} measured events (source publication → stored here)`}>
          <span className="text-ink-400">Measured feed delay </span>
          <span className="font-medium text-ink-800">{delay.medianSeconds < 120 ? `${delay.medianSeconds} s` : `${Math.round(delay.medianSeconds / 60)} min`}</span>
        </span>
      )}
      {p?.registrationDateType && <span className="text-ink-400">Date basis: {p.registrationDateType}</span>}
      <span>
        <span className="text-ink-400">Last successful sync </span>
        {lastFetchedAt ? (
          <span className="font-medium text-ink-800" title={formatDateTime(lastFetchedAt)}>
            {formatDateTime(lastFetchedAt)} ({formatRelative(lastFetchedAt)})
          </span>
        ) : (
          <span className="font-medium text-ink-800">never</span>
        )}
      </span>
      <span className="text-ink-400">Dates in {view.timezone.replace("_", " ")}</span>
    </div>
  );
}

function StatePanel({ view, canSync }: { view: CountryView; canSync: boolean }) {
  const p = view.provider;
  if (!needsAccess(view.state) && hasNoFeed(view.state)) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-ink-100 p-2.5 text-ink-600">
            <PlugZap className="h-6 w-6" aria-hidden />
          </span>
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-ink-900">
              {view.name}: {STATE_LABELS[view.state as UiIntegrationState]} — no daily registration feed is connected
            </h2>
            <p className="max-w-3xl text-sm text-ink-600">{view.stateMessage}</p>
            <p className="text-sm text-ink-600">No counts are shown for {view.name} until a legitimate source is connected — nothing is estimated or generated.</p>
            <Link href={`/dashboard/sources#${view.code}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              <BookOpen className="h-4 w-4" aria-hidden /> Data source options for {view.name}
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (needsAccess(view.state)) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6">
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-amber-100 p-2.5 text-amber-800">
            <KeyRound className="h-6 w-6" aria-hidden />
          </span>
          <div className="space-y-2 text-sm text-amber-950">
            <h2 className="text-base font-semibold">
              {p?.sourceName} {view.state === "NEEDS_APPROVAL" ? "needs an approved agreement and credentials" : "needs credentials"} before {view.name} registrations can be loaded
            </h2>
            <p>{p?.description}</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>
                Register for access{p?.docsUrl && (
                  <>
                    {" "}
                    at{" "}
                    <a className="font-medium underline" href={p.docsUrl} target="_blank" rel="noopener noreferrer">
                      {new URL(p.docsUrl).hostname}
                    </a>
                  </>
                )}
                .
              </li>
              <li>
                Add <code className="rounded bg-white/70 px-1">{p?.requiredEnv.join(", ")}</code> to the server environment (<code className="rounded bg-white/70 px-1">.env.local</code>).
              </li>
              <li>Restart the application. The first sync runs automatically{canSync ? ", or use Sync today" : ""}.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * The daily company-intelligence workspace: TODAY's registrations for one
 * country (or all), with readable contact details, filters, quick
 * qualification, drawer review and export.
 */
export async function DailyWorkspace({ actor, country, searchParams, basePath, mode = "daily", fixedPath = false, title }: { actor: Actor; country: string; searchParams: SP; basePath: string; mode?: WorkspaceMode; fixedPath?: boolean; title?: string }) {
  const code = country.toUpperCase();
  const defaultRange = mode === "daily" ? "today" : "all";
  const range = str(searchParams.range) ?? defaultRange;
  const from = str(searchParams.from);
  const to = str(searchParams.to);
  const page = str(searchParams.page);

  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) {
    const s = str(v);
    if (s && k !== "country") params[k] = s;
  }
  const listInput = { ...params, country: code, range, ...(mode === "saved" && { saved: "yes" }) };

  const [cards, overview, list] = await Promise.all([listCountryCards(actor), getRegistrationOverview(actor, code, range, from, to), listCompanies(actor, listInput)]);
  const delay = overview.view?.provider ? await feedDelayStats(overview.view.provider.id) : null;
  const viewKey = (str(searchParams.view) ?? "registered") as CompanyView;
  const view = overview.view;
  const dr = overview.range;
  const isToday = dr.singleDay === dr.today;
  const canSendToMarketer = isOwner(actor) && can(actor, "leads.sendToMarketer");
  const sentCounts = canSendToMarketer ? await activeAssignmentCounts(list.items.map((c) => c._id)) : new Map<string, number>();
  const rows = list.items.map((c) => ({ ...toCompanyRow(c), sentToMarketers: sentCounts.get(String(c._id)) ?? 0 }));
  const capabilities: Record<string, SourceCapabilities> = {};
  for (const v of await getEnabledCountries()) {
    const caps = v.provider?.capabilities;
    capabilities[v.code] = caps
      ? { email: caps.supportsEmail, phone: caps.supportsPhone, mobile: caps.supportsMobile, website: caps.supportsWebsite, person: caps.supportsRoles || caps.supportsDirectors }
      : { email: true, phone: true, mobile: true, website: true, person: true };
  }

  const qs = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...params, ...(fixedPath ? {} : { country: code }) });
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    const s = p.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const exportParams = new URLSearchParams({ ...params, country: code, range, ...(mode === "saved" && { saved: "yes" }) });
  exportParams.delete("page");

  const countryLabel = code === ALL ? "All countries" : view?.name ?? code;
  const adjective = code === ALL ? "" : `${view?.adjective ?? ""} `;
  const heading =
    title ??
    (mode === "saved"
      ? "Saved leads"
      : mode === "research"
        ? `${countryLabel} — all companies`
        : isToday
          ? `${adjective}companies registered today`
          : `${adjective}companies registered ${dr.label}`);
  const sel = overview.selected;
  const unavailable = view?.state === "PROVIDER_ERROR";
  const blocked = view && hasNoFeed(view.state);
  const canSync = can(actor, "registry.sync") && !!view && view.dailyFeed;
  const canExport = can(actor, "companies.export");
  const canQualify = can(actor, "leads.manage");
  const emailContext = ownerEmailContext(actor);
  const lastFetchedAt = view?.lastSuccessAt ?? null;
  const bigLabel = isToday ? "Today" : DATE_PRESET_LABELS[dr.preset] === "Custom range" ? (dr.singleDay ? formatDay(dr.singleDay, { weekday: "long", day: "numeric", month: "long" }) : dr.label) : DATE_PRESET_LABELS[dr.preset];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3 xl:flex-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Company Intelligence{mode === "daily" ? " · New registrations" : ""}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.7rem]">
              {code !== ALL && view?.flag && <span className="mr-2" aria-hidden>{view.flag}</span>}
              {heading.charAt(0).toUpperCase() + heading.slice(1)}
            </h1>
            <p className="mt-1 text-sm text-ink-600">Discover newly registered businesses and their available company and contact information.</p>
          </div>
          <CountryDateBar
            key={`${code}-${range}-${from}-${to}`}
            countries={cards.map((c) => ({ code: c.code, slug: c.slug, name: c.name, flag: c.flag, today: c.today }))}
            current={code}
            fixedPath={fixedPath}
            range={dr.preset}
            from={from}
            to={to}
            defaultRange={defaultRange}
          />
          {view && <SourcePanel view={view} lastFetchedAt={lastFetchedAt} delay={delay} />}
          {code === ALL && <p className="text-xs text-ink-500">Each country is filtered by its own local date and its source&apos;s own registration-date meaning (see Coverage). Countries without a connected feed are not included in counts.</p>}
        </div>
        {code !== ALL && view && (
          <SyncControls
            country={code}
            canSync={canSync}
            canExport={canExport}
            exportHref={`/api/companies/export?${exportParams.toString()}`}
            realTime={view.provider?.freshness === "REAL_TIME"}
            lastFetchedAt={lastFetchedAt ? new Date(lastFetchedAt).toISOString() : null}
            syncDay={dr.singleDay}
            isToday={isToday}
            runningSyncId={overview.running ? String(overview.running._id) : null}
            disabledReason={blocked ? "No connected feed for this country" : undefined}
          />
        )}
        {code === ALL && canExport && (
          <a href={`/api/companies/export?${exportParams.toString()}`} className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50" download>
            Export CSV
          </a>
        )}
      </div>

      {unavailable && view && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{view.name} registry is temporarily unavailable.</p>
            {view.stateMessage && <p className="mt-0.5 text-red-800">{view.stateMessage}</p>}
            <p className="mt-1 text-red-800">
              Last successful synchronization: <strong>{view.lastSuccessAt ? formatDateTime(view.lastSuccessAt) : "never"}</strong>. The list below is the last known data — nothing has been substituted. Use “Sync today” to retry.
            </p>
          </div>
        </div>
      )}

      <LiveUpdates country={code} />

      {mode === "daily" && !blocked && (
        <nav aria-label="Daily views" className="flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-white p-1">
          {(
            [
              ["registered", "Registered", overview.views.registered, "Companies whose registry registration date falls in the selected period"],
              ["received", "First received", overview.views.received, "Companies first stored by ExploreTechify in the period — any registration date"],
              ["contacts", "Contacts found", overview.views.contactsFound, "Companies whose first usable direct contact was found in the period — any registration date"],
            ] as const
          ).map(([key, label, count, hint]) => {
            const active = viewKey === key;
            return (
              <Link key={key} href={qs({ view: key === "registered" ? null : key })} title={hint} aria-current={active || undefined} className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium", active ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50")}>
                {label} {isToday ? "today" : dr.label}
                {isToday && <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-white/20" : "bg-ink-100 text-ink-700")}>{count === null ? "—" : formatNumber(count)}</span>}
              </Link>
            );
          })}
        </nav>
      )}

      {view && blocked ? (
        <StatePanel view={view} canSync={canSync} />
      ) : mode === "daily" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* KPI hero: TODAY first */}
          <section className="rounded-2xl border border-ink-200 bg-gradient-to-br from-white to-brand-50/40 p-5 lg:min-h-64" aria-label="Registration summary">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                  {bigLabel}
                  {dr.singleDay && !isToday ? "" : isToday ? ` · ${formatDay(dr.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` : ""}
                </p>
                <p className="mt-1 flex items-baseline gap-3">
                  <span className="text-6xl font-semibold leading-none tracking-tight tabular-nums text-ink-900">{sel.known ? formatNumber(sel.total) : "—"}</span>
                  <span className="text-lg font-medium text-ink-700">received registration{sel.total === 1 ? "" : "s"}</span>
                </p>
                {!sel.known && <p className="mt-2 text-sm text-ink-500">No verified data available — {isToday ? "today hasn't been synced yet." : "this period hasn't been synced."} {canSync ? "Use “Sync today” to fetch it now." : "It syncs automatically."}</p>}
                {sel.known && sel.coveredDays < sel.totalDays && <p className="mt-2 text-xs text-amber-700">Covers {sel.coveredDays} of {sel.totalDays} days — the rest haven&apos;t been synced.</p>}
                {sel.known && !sel.complete && <p className="mt-2 text-xs text-amber-700">The source reported more records than one sync imports; counts may be incomplete.</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                <QuickStat label="Today" value={overview.quick.today} href={qs({ range: null, from: null, to: null })} active={isToday} />
                <QuickStat label="Yesterday" value={overview.quick.yesterday} href={qs({ range: "yesterday", from: null, to: null })} active={dr.preset === "yesterday"} />
                <QuickStat label="7 days" value={overview.quick.last7} href={qs({ range: "7d", from: null, to: null })} active={dr.preset === "7d"} />
                <QuickStat label="This month" value={overview.quick.month} href={qs({ range: "month", from: null, to: null })} active={dr.preset === "month"} />
              </div>
            </div>
            {sel.known && (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <Kpi label="Direct contact (email or phone)" value={overview.research.directContacts} total={sel.total} tone="good" />
                  <Kpi label="Email available" value={overview.research.withEmail} total={sel.total} />
                  <Kpi label="Phone available" value={overview.research.publishedPhones} total={sel.total} />
                  <Kpi label="Website available" value={overview.research.withWebsite} total={sel.total} />
                  <Kpi label="Contact person" value={overview.research.withPerson} total={sel.total} />
                  <Kpi label="Research pending" value={overview.research.pendingResearch} total={sel.total} />
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Direct-contact coverage {sel.total ? `${Math.round((overview.research.directContacts / sel.total) * 100)}%` : "—"} (a company with both email and phone counts once) · {formatNumber(overview.research.verifiedEmails)} deliverability-verified email{overview.research.verifiedEmails === 1 ? "" : "s"} · {formatNumber(overview.research.formOnly)} with a contact form only. Contact person = named by the registry or the company&apos;s own website. &ldquo;Received registrations&rdquo; = what the source has delivered so far; national completeness is only claimed where the source documents it.
                </p>
              </>
            )}
            {view && (
              <p className="mt-3 text-xs text-ink-600">
                <span className="font-medium">Update window:</span> {view.jurisdiction.updateWindow}. Counts are by the registry&apos;s own registration date ({view.timezone.replace("_", " ")}); companies published late are added to their real registration day, never to the day they were fetched.
              </p>
            )}
            {view?.provider?.limitations && <p className="mt-1 text-xs text-ink-500">{view.provider.limitations}</p>}
          </section>
          <Timeline data={overview.timeline} selectedDay={dr.singleDay} hrefFor={(d) => qs({ range: "custom", from: d, to: d })} />
        </div>
      ) : null}

      {!blocked && (
        <section aria-label="Companies" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink-900">
              {mode === "daily" ? (isToday ? "Today's new companies" : `Companies registered ${dr.label}`) : heading}{" "}
              <span className="text-sm font-normal text-ink-500">· {formatNumber(list.total)} {list.total === 1 ? "match" : "matches"}</span>
            </h2>
            {mode !== "daily" && <span className="text-xs text-ink-500">Registration date: {DATE_PRESET_LABELS[dr.preset].toLowerCase()}</span>}
          </div>
          <CompanyFilters industries={INDUSTRIES.map((i) => ({ value: i, label: INDUSTRY_LABELS[i] }))} sorts={COMPANY_SORTS.map((s) => ({ value: s, label: COMPANY_SORT_LABELS[s] }))} />
          {rows.length ? (
            <>
              <RegistrationsTable rows={rows} capabilities={capabilities} canQualify={canQualify} canSendToMarketer={canSendToMarketer} showCountry={code === ALL} emailContext={emailContext} />
              <Pagination
                page={list.page}
                pageCount={list.pageCount}
                total={list.total}
                buildHref={(p) => {
                  const u = new URLSearchParams({ ...params, ...(fixedPath ? {} : { country: code }), page: String(p) });
                  return `${basePath}?${u.toString()}`;
                }}
              />
            </>
          ) : (
            <EmptyState
              icon={Building2}
              title={page && Number(page) > 1 ? "No more companies" : Object.keys(params).some((k) => !["range", "from", "to", "sort"].includes(k)) ? "No companies match these filters" : sel.known ? `No companies registered ${dr.label}` : "No verified data available for this period yet"}
              description={
                sel.known || mode !== "daily"
                  ? "Try another date or clear the filters."
                  : canSync
                    ? "Press “Sync today” to fetch registrations from the official source."
                    : "Registrations are fetched automatically on the source's schedule."
              }
            />
          )}
        </section>
      )}
      {rows.some((r) => r.isDemo) && <p className="text-xs font-medium text-amber-800">Rows marked DEMO are fictional demo data (DEMO_MODE) — not real registrations.</p>}
      {view?.provider && <p className="text-[11px] text-ink-400">Freshness: {DATA_FRESHNESS_LABELS[view.provider.freshness]} · registration dates as published by {view.provider.sourceName}, grouped by the local date in {view.timezone}.</p>}
    </div>
  );
}

