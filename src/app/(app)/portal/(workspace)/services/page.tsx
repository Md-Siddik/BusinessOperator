import { SERVICE_CATEGORIES } from "@/config/services";
import { CLIENT_SERVICE_STATUSES } from "@/lib/constants";
import { requireClientPage } from "@/lib/auth/session";
import { formatDate, humanize } from "@/lib/utils/format";
import { getMessages } from "@/lib/i18n/dictionaries";
import { getPath } from "@/lib/i18n/translator";
import { listClientServices } from "@/features/clients/service";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/data";
import { RequestServiceButton } from "@/components/app/portal-forms";

export const metadata = { title: "Services" };

const SECTION: Record<string, string> = { ACTIVE: "Active services", PENDING: "Pending services", REQUESTED: "Requested services", COMPLETED: "Completed services" };

export default async function PortalServicesPage() {
  const actor = await requireClientPage();
  const [services, en] = await Promise.all([listClientServices(actor, actor.organizationId!), getMessages("en")]);
  const labels = Object.fromEntries(SERVICE_CATEGORIES.map((c) => [c.slug, getPath(en, `services.categories.${c.key}.name`) as string]));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="Services" description="Everything we run for you, grouped by status." actions={<RequestServiceButton labels={labels} />} />
      {(["ACTIVE", "PENDING", "REQUESTED", "COMPLETED"] as (typeof CLIENT_SERVICE_STATUSES)[number][]).map((status) => {
        const items = services.filter((s) => s.status === status);
        return (
          <Card key={status}>
            <CardHeader title={`${SECTION[status]} (${items.length})`} />
            <ul className="divide-y divide-ink-100">
              {items.map((s) => (
                <li key={String(s._id)} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-ink-500">
                      {labels[s.category] ?? humanize(s.category)}
                      {s.startedAt && ` · since ${formatDate(s.startedAt)}`}
                      {s.completedAt && ` · completed ${formatDate(s.completedAt)}`}
                      {s.notes && ` · ${s.notes}`}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
              {items.length === 0 && <li className="px-5 py-3 text-sm text-ink-500">None.</li>}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
