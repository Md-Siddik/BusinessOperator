import Link from "next/link";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getPipeline } from "@/features/crm/service";
import { getSetting } from "@/features/settings/service";
import { resolveCountry } from "@/features/site/country-context";
import { PageHeader } from "@/components/ui/data";
import { CrmTabs } from "@/components/app/section-tabs";
import { PipelineBoard } from "@/components/app/pipeline-board";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ country?: string; mine?: string }> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const mine = sp.mine === "true" || !can(actor, "leads.manage");
  const [columns, scoring] = await Promise.all([getPipeline(actor, ctx.code, { mine }), getSetting("leadScoring")]);
  const data = columns.map((c) => ({
    stage: c.stage,
    label: c.label,
    count: c.count,
    items: c.items.map((i) => ({ id: String(i._id), name: i.companyName, countryCode: i.countryCode, city: i.city ?? undefined, score: i.lead?.score ?? 0, stage: i.lead?.stage ?? c.stage, isDemo: i.isDemo })),
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title={`Pipeline · ${ctx.country?.name ?? "All Countries"}`}
        description="Drag leads between stages, or use the stage menu on each card."
        actions={
          can(actor, "leads.manage") ? (
            <Link href={`/dashboard/crm/pipeline?country=${ctx.code}${mine ? "" : "&mine=true"}`} className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50">
              {mine ? "Show everyone's leads" : "Show only my leads"}
            </Link>
          ) : null
        }
      />
      <CrmTabs active="pipeline" country={ctx.code} />
      <PipelineBoard key={`${ctx.code}-${mine}`} initial={data} threshold={scoring.qualifiedThreshold} />
    </div>
  );
}
