import Link from "next/link";
import { Activity, Clock, Eye, Footprints, MessageSquareText, Repeat, Users } from "lucide-react";
import { requireOwnerPage } from "@/lib/auth/session";
import { formatNumber } from "@/lib/utils/format";
import { getSetting } from "@/features/settings/service";
import { ownerMetadata } from "@/features/opportunities/metadata";
import {
  analyticsRange,
  getCampaigns,
  getLocations,
  getOverview,
  getPages,
  getRecentVisits,
  getServicePerformance,
  getSources,
  listVisitors,
  type LocationRow,
  type PerformanceRow,
  type RecentVisit,
} from "@/features/website-analytics/service";
import { SESSION_TIMEOUT_MS } from "@/features/website-analytics/classify";
import { Card, CardHeader } from "@/components/ui/card";
import { KpiCard, LinkTabs, PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ChartCard } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/charts";
import { ANALYTICS_PATH, ExportLinks, fmtDateTime, fmtDuration, fmtLocalTime, fmtRate, Location, RangeBar, VisitorStatusBadge } from "@/components/website-analytics/parts";
import { RetentionForm } from "@/components/website-analytics/retention-form";
import { CONVERSION_LABELS, getHistory, listLeads, parseGranularity, type History, type LeadRow } from "@/features/website-analytics/history";
import { rollupIfStale } from "@/features/website-analytics/rollup";
import { CHANNEL_LABELS, type Channel } from "@/features/website-analytics/classify";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Website Analytics");

const TABS = [
  ["overview", "Overview"],
  ["marketing", "Marketing"],
  ["locations", "Locations"],
  ["pages", "Pages & services"],
  ["visitors", "Visitors"],
  ["history", "History"],
  ["leads", "Leads"],
] as const;
/** Tabs read from the permanent daily statistics / lead records, not from raw (expiring) events. */
const DURABLE_TABS = new Set(["history", "leads"]);

type SP = Record<string, string | undefined>;

/** Website visitor analytics — OWNER ONLY (proxy, this page guard, the API routes and the service all check). */
export default async function WebsiteAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireOwnerPage();
  const sp = await searchParams;
  const tab = TABS.some(([id]) => id === sp.tab) ? sp.tab! : "overview";
  const r = analyticsRange(sp);
  const durable = DURABLE_TABS.has(tab);
  if (durable) {
    // Keep today's row current when the Owner looks at history (idempotent; closed days are frozen).
    await rollupIfStale().catch((err) => console.error("[analytics] roll-up failed", err));
  }
  const overview = await getOverview(actor, r);
  const empty = !durable && overview.pageViews === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website"
        title="Website Analytics"
        description={`Visits to the public website ${r.label}. Visitors stay anonymous unless they log in or send an enquiry themselves. Times in Norwegian time.`}
        actions={<ExportLinks range={r} />}
      />
      <RangeBar sp={sp} range={r} />
      <LinkTabs active={tab} tabs={TABS.map(([id, label]) => ({ id, label, href: withParams(ANALYTICS_PATH, sp, { tab: id === "overview" ? null : id, page: null }) }))} />

      {empty ? (
        <Card>
          <EmptyState
            icon={Activity}
            title="No visitor activity recorded yet."
            description="Nothing was recorded for this period. Activity appears here as soon as people visit the public website — your own team's visits are not counted."
          />
        </Card>
      ) : tab === "overview" ? (
        <OverviewTab overview={overview} sources={await getSources(actor, r)} recent={await getRecentVisits(actor, r, 15)} multiDay={r.from !== r.to} />
      ) : tab === "marketing" ? (
        <MarketingTab sources={await getSources(actor, r)} campaigns={await getCampaigns(actor, r)} />
      ) : tab === "locations" ? (
        <LocationsTab locations={await getLocations(actor, r)} recent={await getRecentVisits(actor, r, 50)} />
      ) : tab === "pages" ? (
        <PagesTab services={await getServicePerformance(actor, r)} pages={await getPages(actor, r)} />
      ) : tab === "history" ? (
        <HistoryTab sp={sp} history={await getHistory(actor, r, parseGranularity(sp.by), Number(sp.page) || 1)} />
      ) : tab === "leads" ? (
        <LeadsTab sp={sp} leads={await listLeads(actor, r, { page: Number(sp.page) || 1, type: sp.type })} />
      ) : (
        <VisitorsTab sp={sp} list={await listVisitors(actor, r, { page: Number(sp.page) || 1 })} />
      )}

      <PrivacyCard retentionDays={(await getSetting("analytics")).retentionDays} />
    </div>
  );
}

function OverviewTab({ overview: o, sources, recent, multiDay }: { overview: Awaited<ReturnType<typeof getOverview>>; sources: PerformanceRow[]; recent: RecentVisit[]; multiDay: boolean }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Visitors" value={formatNumber(o.visits)} icon={Footprints} tone="brand" hint={o.cookielessVisits ? `All visits, incl. ${formatNumber(o.cookielessVisits)} without analytics consent` : "All visits in this period"} />
        <KpiCard label="Unique visitors" value={formatNumber(o.uniqueVisitors)} icon={Users} hint={`${formatNumber(o.newVisitors)} new · browsers that accepted analytics`} />
        <KpiCard label="Returning visitors" value={formatNumber(o.returningVisitors)} icon={Repeat} hint="Came back after an earlier visit" />
        <KpiCard label="Sessions" value={formatNumber(o.sessions)} icon={Activity} hint={`A visit ends after ${SESSION_TIMEOUT_MS / 60_000} min of inactivity`} />
        <KpiCard label="Page views" value={formatNumber(o.pageViews)} icon={Eye} />
        <KpiCard label="Avg. session duration" value={fmtDuration(o.avgSessionSeconds)} icon={Clock} />
        <KpiCard label="Enquiries" value={formatNumber(o.enquiries)} icon={MessageSquareText} tone="success" hint={`Contact-form enquiries · ${formatNumber(o.linkedEnquiries)} linked to a tracked visit`} />
      </div>
      {multiDay && (
        <ChartCard title="Visits and page views per day" table={{ columns: ["Day", "Visits", "Page views"], rows: o.daily.map((d) => [d.day, d.visits, d.pageViews]) }}>
          <LineChart data={o.daily} xKey="day" series={[{ key: "visits", label: "Visits" }, { key: "pageViews", label: "Page views" }]} />
        </ChartCard>
      )}
      <RecentVisitsCard visits={recent} />
      <PerformanceTable title="Traffic sources" description="How visitors reached the website." rows={sources} kind="source" />
    </>
  );
}

/** When each visit happened, from where, how it arrived and where it landed — newest first. */
function RecentVisitsCard({ visits, title = "Recent visits" }: { visits: RecentVisit[]; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} description="Newest first. Times in Norwegian time; the visitor's own local time is shown when it differs." />
      {visits.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">No visits in this period.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Visited</TH>
              <TH>Location</TH>
              <TH>Visitor</TH>
              <TH>Arrived via</TH>
              <TH>Landing page</TH>
              <TH className="text-right">Pages</TH>
            </TR>
          </THead>
          <TBody>
            {visits.map((v, i) => {
              const local = fmtLocalTime(v.at, v.timeZone);
              return (
                <TR key={`${v.at}-${i}`}>
                  <TD className="whitespace-nowrap">
                    <span className="text-ink-900">{fmtDateTime(v.at)}</span>
                    {local && <span className="block text-xs text-ink-500">{local}</span>}
                  </TD>
                  <TD className="max-w-[16rem]">
                    <Location geo={v.geo} />
                  </TD>
                  <TD className="whitespace-nowrap">
                    {v.kind === "tracked" && v.visitorId ? (
                      <Link href={`${ANALYTICS_PATH}/visitors/${v.visitorId}`} className="font-medium text-brand-700 hover:underline">
                        #{v.label} <span className="font-normal text-ink-500">· visit {v.sessionNo}</span>
                      </Link>
                    ) : (
                      <span className="text-ink-500" title="This visitor did not accept analytics, so the visit is counted but not linked to a visitor.">Not tracked</span>
                    )}
                  </TD>
                  <TD className="text-ink-600">{v.channel}</TD>
                  <TD className="max-w-[14rem] truncate text-ink-700">{v.landingPage}</TD>
                  <TD className="text-right tabular-nums text-ink-600">
                    {v.pageViews ?? "—"}
                    {v.durationSeconds ? <span className="block text-xs text-ink-400">{fmtDuration(v.durationSeconds)}</span> : null}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function LocationsTab({ locations, recent }: { locations: { countries: LocationRow[]; areas: LocationRow[] }; recent: RecentVisit[] }) {
  const table = (rows: LocationRow[], countryOnly: boolean) => (
    <Table>
      <THead>
        <TR>
          <TH>{countryOnly ? "Country" : "Area"}</TH>
          <TH className="text-right">Visitors</TH>
          <TH className="text-right">Sessions</TH>
          <TH className="text-right" title="Visits from browsers that did not accept analytics">Other visits</TH>
          <TH className="text-right">Page views</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((l) => (
          <TR key={l.key}>
            <TD className="max-w-[20rem] font-medium text-ink-900">
              <Location geo={l} countryOnly={countryOnly} />
            </TD>
            <TD className="text-right tabular-nums">{formatNumber(l.visitors)}</TD>
            <TD className="text-right tabular-nums">{formatNumber(l.sessions)}</TD>
            <TD className="text-right tabular-nums text-ink-500">{formatNumber(l.cookielessVisits)}</TD>
            <TD className="text-right tabular-nums">{formatNumber(l.pageViews)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Countries" description="Where visits came from. Coarse location only — no IP addresses are stored." />
          {table(locations.countries, true)}
        </Card>
        <Card>
          <CardHeader title="Areas" description="City and region where known (top 50)." />
          {table(locations.areas, false)}
        </Card>
      </div>
      <RecentVisitsCard visits={recent} title="Visits with location" />
    </>
  );
}

function MarketingTab({ sources, campaigns }: { sources: PerformanceRow[]; campaigns: PerformanceRow[] }) {
  return (
    <>
      <PerformanceTable title="Traffic sources" description="From UTM tags first, then the referring website. Email outreach links are tagged automatically." rows={sources} kind="source" />
      <PerformanceTable title="Campaigns" description="Visits that arrived through a link with utm_campaign." rows={campaigns} kind="campaign" emptyText="No campaign-tagged visits in this period." />
    </>
  );
}

function PerformanceTable({ title, description, rows, kind, emptyText }: { title: string; description: string; rows: PerformanceRow[]; kind: "source" | "campaign"; emptyText?: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">{emptyText ?? "No visits in this period."}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{kind === "source" ? "Source" : "Campaign"}</TH>
              {kind === "campaign" && <TH>Source / medium</TH>}
              <TH className="text-right">Visitors</TH>
              <TH className="text-right">Sessions</TH>
              <TH className="text-right" title="Visits from browsers that did not accept analytics">Other visits</TH>
              <TH className="text-right">Page views</TH>
              <TH className="text-right">Enquiries</TH>
              <TH className="text-right" title="Tracked sessions that sent an enquiry">Conversion</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.key}>
                <TD className="font-medium text-ink-900">{p.label}</TD>
                {kind === "campaign" && <TD className="text-ink-600">{[p.source, p.medium].filter(Boolean).join(" / ") || "—"}</TD>}
                <TD className="text-right tabular-nums">{formatNumber(p.visitors)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.sessions)}</TD>
                <TD className="text-right tabular-nums text-ink-500">{formatNumber(p.cookielessVisits)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.pageViews)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.enquiries)}</TD>
                <TD className="text-right tabular-nums">{fmtRate(p.conversionRate)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function PagesTab({ services, pages }: { services: Awaited<ReturnType<typeof getServicePerformance>>; pages: Awaited<ReturnType<typeof getPages>> }) {
  return (
    <>
      <Card>
        <CardHeader title="Service pages" description="Interest per service from Service Management. Enquiries are contact-form submissions sent from that service's page." />
        {services.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-500">No services in Service Management yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Service</TH>
                <TH className="text-right">Views</TH>
                <TH className="text-right">Unique visitors</TH>
                <TH className="text-right">Returning</TH>
                <TH className="text-right" title="Visits that started on this page">Landings</TH>
                <TH className="text-right">Enquiries</TH>
                <TH className="text-right" title="Enquiries per visit that viewed the page">Conversion</TH>
              </TR>
            </THead>
            <TBody>
              {services.map((s) => (
                <TR key={s.slug}>
                  <TD>
                    <span className="font-medium text-ink-900">{s.name}</span>
                    <span className="block text-xs text-ink-500">/services/{s.slug}{s.active ? "" : " · not published"}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(s.views)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(s.visitors)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(s.returningVisitors)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(s.landings)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(s.enquiries)}</TD>
                  <TD className="text-right tabular-nums">{fmtRate(s.conversionRate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Most viewed pages" description="All languages combined. Landings = visits that started on the page." />
        <Table>
          <THead>
            <TR>
              <TH>Page</TH>
              <TH className="text-right">Views</TH>
              <TH className="text-right">Unique visitors</TH>
              <TH className="text-right">Landings</TH>
            </TR>
          </THead>
          <TBody>
            {pages.map((p) => (
              <TR key={p.page}>
                <TD className="max-w-[24rem] truncate font-medium text-ink-900">{p.page}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.views)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.visitors)}</TD>
                <TD className="text-right tabular-nums">{formatNumber(p.landings)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

function VisitorsTab({ sp, list }: { sp: SP; list: Awaited<ReturnType<typeof listVisitors>> }) {
  return (
    <Card>
      <CardHeader title="Visitors" description="Browsers that accepted analytics and visited in this period. Open one to see its visits page by page." />
      {list.items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">No visitors with analytics consent in this period. Visits without consent are counted in the totals only.</p>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Visitor</TH>
                <TH>Location</TH>
                <TH>First seen</TH>
                <TH>Last seen</TH>
                <TH className="text-right" title="Sessions in this period / in total">Sessions</TH>
                <TH className="text-right" title="Page views in this period">Pages viewed</TH>
                <TH>Source</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <Link href={`${ANALYTICS_PATH}/visitors/${v.id}`} className="font-medium text-brand-700 hover:underline">
                      {v.userName ?? `Anonymous #${v.label}`}
                    </Link>
                    {v.userName && <span className="block text-xs text-ink-500">#{v.label}</span>}
                  </TD>
                  <TD className="max-w-[14rem] text-ink-700">
                    <Location geo={v.geo} />
                  </TD>
                  <TD className="whitespace-nowrap text-ink-600">{fmtDateTime(v.firstSeen)}</TD>
                  <TD className="whitespace-nowrap text-ink-600">{fmtDateTime(v.lastSeen)}</TD>
                  <TD className="text-right tabular-nums">
                    {v.sessionsInRange}
                    {v.totalSessions > v.sessionsInRange && <span className="text-ink-400"> / {v.totalSessions}</span>}
                  </TD>
                  <TD className="text-right tabular-nums">{v.pageViewsInRange}</TD>
                  <TD className="text-ink-600">{v.source}</TD>
                  <TD>
                    <VisitorStatusBadge status={v.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={list.page} pageCount={list.pageCount} total={list.total} buildHref={(p) => withParams(ANALYTICS_PATH, sp, { page: p })} />
        </>
      )}
    </Card>
  );
}

function PrivacyCard({ retentionDays }: { retentionDays: number }) {
  return (
    <Card>
      <CardHeader title="Privacy" description="How this data is collected. Visible to the Owner only." />
      <div className="space-y-3 px-5 pb-5 text-sm text-ink-600">
        <ul className="list-disc space-y-1 pl-5">
          <li>Visitors choose Accept or Deny in a dialog on the website. Only after “Accept” is anything recorded: the browser gets a random, anonymous visitor cookie, so return visits can be recognised.</li>
          <li>Before a choice and after “Deny” nothing is recorded. (Until October 2026, page views without consent were counted without any identifier; those older numbers are kept as “visits without consent”.)</li>
          <li>Daily statistics (History tab) are kept permanently and contain no personal data. Raw visit records follow the retention period below.</li>
          <li>No IP addresses, fingerprints or full referrer URLs are stored. A visitor is linked to a person only when they log in or send an enquiry themselves.</li>
          <li>
            Location is coarse (country, region, city), taken from the hosting platform or a local database at the moment of the visit; the IP address is used only for that lookup and then discarded. IP geolocation by{" "}
            <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
              DB-IP
            </a>
            .
          </li>
          <li>Crawlers, monitoring tools and automated browsers are filtered out. Your team&apos;s own visits are not counted.</li>
        </ul>
        <RetentionForm current={retentionDays} />
      </div>
    </Card>
  );
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? "new" : "—";
  const d = (cur - prev) / prev;
  return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%`;
}
const dayFmt = (day: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
function periodLabel(p: string, by: string) {
  if (by === "day") return dayFmt(p, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (by === "month") return dayFmt(p, { month: "long", year: "numeric" });
  return `Week of ${dayFmt(p, { day: "numeric", month: "short", year: "numeric" })}`;
}
/** Export link for the selected range (preset or custom). */
function exportHref(kind: string, sp: SP) {
  const q = new URLSearchParams({ kind });
  if (sp.range) q.set("range", sp.range);
  if (sp.range === "custom") {
    if (sp.from) q.set("from", sp.from);
    if (sp.to) q.set("to", sp.to);
  }
  return `/api/website-analytics/export?${q}`;
}

/** Permanent daily statistics: day / week / month periods, compared with the previous period. */
function HistoryTab({ sp, history: h }: { sp: SP; history: History }) {
  const t = h.totals;
  const prev = h.previous;
  const by = h.granularity;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs active={by} tabs={(["day", "week", "month"] as const).map((g) => ({ id: g, label: g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly", href: withParams(ANALYTICS_PATH, sp, { by: g === "day" ? null : g, page: null }) }))} />
        <p className="text-xs text-ink-500">All dates are calendar days in {h.timeZone} (Norwegian time).</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Unique visitors" value={formatNumber(t.uniqueVisitors)} icon={Users} tone="brand" hint={`${t.uniqueExact ? "Distinct browsers" : "Sum of daily unique visitors"} · ${delta(t.uniqueVisitors, prev.uniqueVisitors)} vs previous ${t.days} day${t.days === 1 ? "" : "s"}`} />
        <KpiCard label="Sessions" value={formatNumber(t.sessions)} icon={Activity} hint={`${delta(t.sessions, prev.sessions)} vs previous period`} />
        <KpiCard label="Page views" value={formatNumber(t.pageViews)} icon={Eye} hint={`${delta(t.pageViews, prev.pageViews)} vs previous period`} />
        <KpiCard label="Leads" value={formatNumber(t.leads)} icon={MessageSquareText} tone="success" hint={`${formatNumber(t.contactForms)} enquiries · ${formatNumber(t.consultationRequests)} consultation requests · ${formatNumber(t.clientSignups)} sign-ups · ${delta(t.leads, prev.leads)}`} />
        <KpiCard label="Conversion rate" value={fmtRate(t.conversionRate)} icon={Repeat} hint={`Tracked sessions that sent a lead · previous period ${fmtRate(prev.conversionRate)}`} />
      </div>
      {h.daysWithData === 0 ? (
        <Card>
          <EmptyState icon={Activity} title="No daily statistics for this period." description="Days are added automatically from recorded visits and enquiries. Nothing is estimated for days without records." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${by === "day" ? "Daily" : by === "week" ? "Weekly" : "Monthly"} statistics`}
            description={`Newest first. Compared with ${prev.from} – ${prev.to}.${h.partialDays ? ` ${h.partialDays} day(s) marked * may be incomplete: their raw records had started to expire before they were first saved.` : ""}`}
            action={
              <a href={exportHref("daily", sp)} className="text-sm font-medium text-brand-700 hover:underline">
                Export daily CSV
              </a>
            }
          />
          <Table>
            <THead>
              <TR>
                <TH>Period</TH>
                <TH className="text-right" title="Distinct browsers that accepted analytics">Unique visitors</TH>
                <TH className="text-right">Sessions</TH>
                <TH className="text-right">Page views</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right" title="Tracked sessions that sent a lead ÷ tracked sessions">Conversion</TH>
              </TR>
            </THead>
            <TBody>
              {h.periods.map((p) => (
                <TR key={p.period}>
                  <TD className="whitespace-nowrap font-medium text-ink-900">
                    {periodLabel(p.period, by)}
                    {p.partial && (
                      <span title="May be incomplete" className="text-amber-700">
                        {" "}*
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(p.uniqueVisitors)}
                    {!p.uniqueExact && <span className="block text-[11px] text-ink-400" title="Raw sessions for this period have expired: sum of daily unique visitors">sum of days</span>}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(p.sessions)}
                    {p.cookielessVisits ? <span className="block text-[11px] text-ink-400">+{formatNumber(p.cookielessVisits)} without consent</span> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(p.pageViews)}</TD>
                  <TD className="text-right tabular-nums">{formatNumber(p.leads)}</TD>
                  <TD className="text-right tabular-nums">{fmtRate(p.conversionRate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {h.pageCount > 1 && (
            <div className="px-5 pb-4">
              <Pagination page={h.page} pageCount={h.pageCount} total={h.totalPeriods} buildHref={(n) => withParams(ANALYTICS_PATH, sp, { page: n })} />
            </div>
          )}
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <KeyTable title="Source attribution" description="Tracked sessions by how each visit arrived." rows={h.sources} first="Source" />
        <KeyTable title="Devices" description="Tracked sessions by device class." rows={h.devices} first="Device" />
      </div>
      <KeyTable title="Top pages" description="Page views per page (language-neutral)." rows={h.pages} first="Page" pagesOnly />
    </>
  );
}

function KeyTable({ title, description, rows, first, pagesOnly }: { title: string; description: string; rows: History["sources"]; first: string; pagesOnly?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">No data in this period.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{first}</TH>
              {!pagesOnly && <TH className="text-right">Sessions</TH>}
              <TH className="text-right">Page views</TH>
              {!pagesOnly && <TH className="text-right">Leads</TH>}
              {!pagesOnly && <TH className="text-right">Conversion</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="max-w-[18rem] truncate font-medium text-ink-900">{r.label}</TD>
                {!pagesOnly && <TD className="text-right tabular-nums">{formatNumber(r.sessions)}</TD>}
                <TD className="text-right tabular-nums">{formatNumber(r.pageViews)}</TD>
                {!pagesOnly && <TD className="text-right tabular-nums">{formatNumber(r.conversions)}</TD>}
                {!pagesOnly && <TD className="text-right tabular-nums">{fmtRate(r.conversionRate)}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function touchText(t?: LeadRow["firstTouch"]) {
  if (!t?.channel) return "—";
  const ch = CHANNEL_LABELS[t.channel as Channel] ?? t.channel;
  return `${ch}${t.utm?.campaign ? ` · ${t.utm.campaign}` : ""}${t.landingPage ? ` → ${t.landingPage}` : ""}`;
}

/** Lead submissions with first- and last-touch attribution (consented browsers only). */
function LeadsTab({ sp, leads }: { sp: SP; leads: Awaited<ReturnType<typeof listLeads>> }) {
  return (
    <Card>
      <CardHeader
        title={`${formatNumber(leads.total)} lead${leads.total === 1 ? "" : "s"}`}
        description="Contact details appear only as the person entered them in the enquiry form or at sign-up. Browsers that did not accept analytics are Anonymous: the lead is counted, but no visits are linked to it."
        action={
          <a href={exportHref("leads", sp)} className="text-sm font-medium text-brand-700 hover:underline">
            Export leads CSV (no contact details)
          </a>
        }
      />
      <div className="px-5 pb-3">
        <LinkTabs active={sp.type ?? "all"} tabs={[{ id: "all", label: "All", href: withParams(ANALYTICS_PATH, sp, { type: null, page: null }) }, ...Object.entries(CONVERSION_LABELS).map(([id, label]) => ({ id, label, href: withParams(ANALYTICS_PATH, sp, { type: id, page: null }) }))]} />
      </div>
      {leads.items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">No leads in this period.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Received</TH>
              <TH>Type</TH>
              <TH>Contact (as provided)</TH>
              <TH>Visitor</TH>
              <TH>First touch</TH>
              <TH>Last touch</TH>
            </TR>
          </THead>
          <TBody>
            {leads.items.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap">{fmtDateTime(l.at)}</TD>
                <TD className="whitespace-nowrap">{CONVERSION_LABELS[l.type] ?? l.type}</TD>
                <TD className="max-w-[16rem]">
                  {l.contact ? (
                    <>
                      {l.contactRequestId ? (
                        <Link href={`/dashboard/inquiries/${l.contactRequestId}`} className="font-medium text-brand-700 hover:underline">
                          {l.contact.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-900">{l.contact.name}</span>
                      )}
                      <span className="block truncate text-xs text-ink-500">{[l.contact.company, l.contact.email, l.contact.phone].filter(Boolean).join(" · ")}</span>
                    </>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  {l.visitor ? (
                    <Link href={`${ANALYTICS_PATH}/visitors/${l.visitor.id}`} className="font-medium text-brand-700 hover:underline">
                      #{l.visitor.label}
                    </Link>
                  ) : (
                    <span className="text-ink-500" title="This browser did not accept analytics — no visits are linked to the lead.">
                      Anonymous
                    </span>
                  )}
                </TD>
                <TD className="max-w-[14rem] truncate text-ink-600">{touchText(l.firstTouch)}</TD>
                <TD className="max-w-[14rem] truncate text-ink-600">{touchText(l.lastTouch)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {leads.pageCount > 1 && (
        <div className="px-5 pb-4">
          <Pagination page={leads.page} pageCount={leads.pageCount} total={leads.total} buildHref={(n) => withParams(ANALYTICS_PATH, sp, { page: n })} />
        </div>
      )}
    </Card>
  );
}
