import Link from "next/link";
import { Users } from "lucide-react";
import { LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { requireInternalPage } from "@/lib/auth/session";
import { listCompanies } from "@/features/companies/service";
import { getSetting } from "@/features/settings/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Pagination, withParams } from "@/components/ui/data";
import { CrmTabs } from "@/components/app/section-tabs";
import { EmptyState } from "@/components/ui/feedback";
import { CompanyTable } from "@/components/app/company-table";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const scoring = await getSetting("leadScoring");
  const result = await listCompanies(actor, { ...sp, country: ctx.code, leadsOnly: "true", sort: sp.sort ?? "score" });
  const path = "/dashboard/crm";
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="CRM" title={`Leads · ${ctx.country?.name ?? "All Countries"}`} description="Companies that have entered the pipeline. Staff see and work on their assigned leads; managers see everyone's." />
      <CrmTabs active="leads" country={ctx.code} />
      <Card>
        <form method="get" action={path} className="flex flex-col gap-3 p-5 md:flex-row" role="search">
          <input type="hidden" name="country" value={ctx.code} />
          <Input name="q" defaultValue={sp.q} placeholder="Search leads" aria-label="Search leads" className="md:flex-1" />
          <Select name="stage" defaultValue={sp.stage ?? ""} aria-label="Stage" className="md:w-52">
            <option value="">All stages</option>
            {LEAD_STAGES.filter((s) => s !== "NEW").map((s) => (
              <option key={s} value={s}>
                {LEAD_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select name="assigned" defaultValue={sp.assigned ?? ""} aria-label="Assignment" className="md:w-48">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </Select>
          <Button type="submit">Filter</Button>
        </form>
        {result.items.length === 0 ? (
          <EmptyState icon={Users} title="No leads match" description={<>Qualified companies appear here once they move beyond &ldquo;New&rdquo;. <Link className="text-brand-700" href={`/dashboard/companies/${ctx.code.toLowerCase()}/browse?minScore=${scoring.qualifiedThreshold}`}>Browse qualified companies</Link></>} />
        ) : (
          <>
            <CompanyTable companies={result.items} showCountry={ctx.code === "ALL"} threshold={scoring.qualifiedThreshold} />
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(page) => withParams(path, { ...sp, country: ctx.code }, { page })} />
          </>
        )}
      </Card>
    </div>
  );
}
