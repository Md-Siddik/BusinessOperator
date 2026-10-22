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

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Website Analytics");

const TABS = [
  ["overview", "Overview"],
  ["marketing", "Marketing"],
  ["locations", "Locations"],
  ["pages", "Pages & services"],
  ["visitors", "Visitors"],
] as const;

type SP = Record<string, string | undefined>;

/** Website visitor analytics — OWNER ONLY (proxy, this page guard, the API routes and the service all check). */
export default async function WebsiteAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireOwnerPage();
  const sp = await searchParams;
  const tab = TABS.some(([id]) => id === sp.tab) ? sp.tab! : "overview";
  const r = analyticsRange(sp);
  const overview = await getOverview(actor, r);
  const empty = overview.pageViews === 0;

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
          <li>Visitors choose in a banner on the website. Only after “Accept” does the browser get a random, anonymous visitor cookie, so return visits can be recognised.</li>
          <li>Without consent, page views are counted with no cookie or identifier, so they appear in totals and sources but not as visitors.</li>
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
