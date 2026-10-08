import Link from "next/link";
import { Folder } from "lucide-react";
import { requireClientPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";
import { listProjects } from "@/features/projects/service";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";

export const metadata = { title: "Projects" };

export default async function PortalProjectsPage() {
  const actor = await requireClientPage();
  const result = await listProjects(actor, {});
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="Projects" description="What we're working on for you, with progress and due dates." />
      {result.items.length === 0 ? (
        <Card>
          <EmptyState icon={Folder} title="No projects yet" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {result.items.map((p) => (
            <Link key={String(p._id)} href={`/portal/projects/${p._id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-lifted">
                <CardContent className="space-y-3 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-ink-900">{p.name}</h2>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.description && <p className="line-clamp-2 text-sm text-ink-600">{p.description}</p>}
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={p.tasks.done} aria-valuemax={p.tasks.total} aria-label="Task progress">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${p.tasks.total ? (p.tasks.done / p.tasks.total) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-ink-500">
                      {p.tasks.done}/{p.tasks.total} tasks
                    </span>
                  </div>
                  <p className="text-xs text-ink-500">
                    {p.startDate && `Started ${formatDate(p.startDate)}`} {p.dueDate && `· Due ${formatDate(p.dueDate)}`}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
