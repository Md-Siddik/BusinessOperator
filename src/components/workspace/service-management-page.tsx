import Link from "next/link";
import { ExternalLink, EyeOff, Layers, Plus, Sparkles, ToggleRight } from "lucide-react";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { isOwner } from "@/lib/permissions";
import { listServicesAdmin } from "@/features/service-catalog/service";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KpiCard, LinkTabs, PageHeader } from "@/components/ui/data";
import { ServiceList } from "@/components/app/service-list";

/**
 * Service Management — Owner, and Admin/Staff with `services.manage` (the page guard here,
 * the API routes and the service layer all check it). Changes are published to the public
 * website immediately.
 */
export async function ServiceManagementPage({ base, trash }: { base: WorkspaceBase; trash?: boolean }) {
  const actor = await requireWorkspacePage(base, "services.manage");
  const { rows, summary } = await listServicesAdmin(actor, { trash });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website"
        title="Service management"
        description="The services, prices, discounts and landing pages shown on the public website. Changes are published immediately; inactive services are hidden."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/services" target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">
              View public services <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <ButtonLink href={`${base}/service-management/new`} size="sm">
              <Plus className="h-4 w-4" aria-hidden /> Add service
            </ButtonLink>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total services" value={summary.total} icon={Layers} />
        <KpiCard label="Active (public)" value={summary.active} icon={ToggleRight} tone="success" />
        <KpiCard label="Featured on homepage" value={summary.featured} icon={Sparkles} tone="brand" />
        <KpiCard label="Inactive / drafts" value={summary.inactive} icon={EyeOff} tone="warning" />
      </div>
      <LinkTabs
        active={trash ? "trash" : "all"}
        tabs={[
          { id: "all", href: `${base}/service-management`, label: "Services", count: summary.total },
          { id: "trash", href: `${base}/service-management?view=trash`, label: "Trash", count: summary.trash },
        ]}
      />
      <Card className="overflow-hidden">
        <ServiceList rows={rows} base={base} trash={!!trash} canDeletePermanently={isOwner(actor)} />
      </Card>
      <p className="text-xs text-ink-500">
        The service price and the way of working are separate: a service shows its own price (fixed, from, monthly or custom quote), while monthly service, task-based work and the selective growth partnership are offered as engagement options. Engagement-model wording is edited in Settings → Languages.
      </p>
    </div>
  );
}
