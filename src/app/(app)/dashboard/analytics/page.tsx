import { Building2, Mail, Phone, Send, Sparkles, Users } from "lucide-react";
import { getCountry } from "@/config/countries";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { requireInternalPage } from "@/lib/auth/session";
import { getAnalytics, type Granularity } from "@/features/analytics/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card, CardHeader } from "@/components/ui/card";
import { KpiCard, LinkTabs, PageHeader, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";
import { ChartCard, Funnel } from "@/components/charts/chart-card";
import { HBarChart, LineChart } from "@/components/charts/charts";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ country?: string; days?: string; granularity?: string }> }) {
  const actor = await requireInternalPage("analytics.view");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const days = Number(sp.days ?? 90) || 90;
  const granularity = (["day", "week", "month"].includes(sp.granularity ?? "") ? sp.granularity : undefined) as Granularity | undefined;
  const a = await getAnalytics(actor, { country: ctx.code, days, granularity });
  const label = ctx.country?.name ?? "All Countries";
  const base = { ...sp, country: ctx.code };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Analytics" title={`Performance · ${label}`} description="Acquisition, outreach and conversion — computed in the database for the selected country." />
      <div className="flex flex-wrap items-center gap-4">
        <LinkTabs active={String(days)} tabs={[30, 90, 180, 365].map((d) => ({ id: String(d), label: `${d} days`, href: withParams("/dashboard/analytics", base, { days: d }) }))} />
        <LinkTabs active={a.granularity} tabs={(["day", "week", "month"] as const).map((g) => ({ id: g, label: g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly", href: withParams("/dashboard/analytics", base, { granularity: g }) }))} />
      </div>

      <section aria-labelledby="acq">
        <h2 id="acq" className="mb-3 text-sm font-semibold text-ink-700">Acquisition</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <KpiCard label="Companies discovered" value={a.acquisition.discovered} icon={Building2} />
          <KpiCard label="Qualified" value={a.acquisition.qualified} icon={Sparkles} tone="success" />
          <KpiCard label="Contactable" value={a.acquisition.contactable} icon={Phone} hint="Email or phone on record" />
        </div>
      </section>
      <section aria-labelledby="out">
        <h2 id="out" className="mb-3 text-sm font-semibold text-ink-700">Outreach</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
          <KpiCard label="Drafted" value={a.outreach.drafted} icon={Mail} />
          <KpiCard label="Sent" value={a.outreach.sent} icon={Send} />
          <KpiCard label="Replies" value={a.outreach.replies} />
          <KpiCard label="Meetings" value={a.outreach.meetings} />
          <KpiCard label="Proposals" value={a.outreach.proposals} />
          <KpiCard label="Clients" value={a.outreach.clients} icon={Users} tone="success" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Discovered vs. qualified" description={`${a.granularity === "day" ? "Daily" : a.granularity === "week" ? "Weekly" : "Monthly"} · by registration date`} table={{ columns: ["Period", "Discovered", "Qualified"], rows: a.series.map((s) => [s.period, s.discovered, s.qualified]) }}>
          <LineChart data={a.series} xKey="period" series={[{ key: "discovered", label: "Discovered" }, { key: "qualified", label: "Qualified" }]} />
        </ChartCard>
        <ChartCard title="Outreach sent vs. replies" description="Same scale, by send date" table={{ columns: ["Period", "Sent", "Replies"], rows: a.series.map((s) => [s.period, s.sent, s.replies]) }}>
          <LineChart data={a.series} xKey="period" series={[{ key: "sent", label: "Sent" }, { key: "replies", label: "Replies" }]} />
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Conversion funnel" description={label} table={{ columns: ["Stage", "Count"], rows: a.funnel.map((f) => [f.stage, f.count]) }}>
          <Funnel steps={a.funnel} />
        </ChartCard>
        <ChartCard title="Companies by country" table={{ columns: ["Country", "Total", "Qualified", "Clients"], rows: a.byCountry.map((c) => [c.name, c.total, c.qualified, c.clients]) }}>
          <HBarChart data={a.byCountry.map((c) => ({ label: `${getCountry(c.country)?.flag ?? ""} ${c.name}`, value: c.total }))} labelKey="label" valueKey="value" name="Companies" />
        </ChartCard>
      </div>

      <Card>
        <CardHeader title="Industry statistics" description={label} />
        <Table>
          <THead>
            <tr>
              <TH>Industry</TH>
              <TH className="text-right">Companies</TH>
              <TH className="text-right">Qualified</TH>
              <TH className="text-right">Qualification rate</TH>
              <TH className="text-right">Avg. score</TH>
            </tr>
          </THead>
          <TBody>
            {a.byIndustry.map((r) => (
              <TR key={r.industry}>
                <TD>{INDUSTRY_LABELS[r.industry as IndustryKey] ?? r.industry}</TD>
                <TD className="text-right tabular-nums">{r.total}</TD>
                <TD className="text-right tabular-nums">{r.qualified}</TD>
                <TD className="text-right tabular-nums">{r.total ? Math.round((r.qualified / r.total) * 100) : 0}%</TD>
                <TD className="text-right tabular-nums">{r.avgScore}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
