import Link from "next/link";
import { Folder } from "lucide-react";
import { PROJECT_STATUSES } from "@/lib/constants";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, humanize } from "@/lib/utils/format";
import { Organization } from "@/models";
import { listProjects } from "@/features/projects/service";
import { listInternalUsers } from "@/features/crm/service";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ProjectEditor } from "@/components/app/client-admin";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string; organizationId?: string; page?: string }> }) {
  const actor = await requireInternalPage();
  const sp = await searchParams;
  const [result, orgs, staff] = await Promise.all([
    listProjects(actor, { status: sp.status, organizationId: sp.organizationId, page: Number(sp.page ?? 1) || 1 }),
    Organization.find({ status: { $ne: "SUSPENDED" } }).select("name").sort({ name: 1 }).lean<{ _id: unknown; name: string }[]>(),
    listInternalUsers(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description={can(actor, "projects.manage") ? "Lightweight client projects — tasks, dates, owners and activity." : "Projects you're assigned to."}
        actions={can(actor, "projects.manage") ? <ProjectEditor orgs={orgs.map((o) => ({ id: String(o._id), name: o.name }))} staff={staff.map((s) => ({ id: String(s._id), name: s.name }))} /> : null}
      />
      <Card>
        <form method="get" className="flex gap-3 p-5">
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-48">
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {result.items.length === 0 ? (
          <EmptyState icon={Folder} title="No projects" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Project</TH>
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH>Progress</TH>
                  <TH>Due</TH>
                  <TH>Team</TH>
                </tr>
              </THead>
              <TBody>
                {result.items.map((p) => (
                  <TR key={String(p._id)}>
                    <TD>
                      <Link href={`/dashboard/projects/${p._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                        {p.name}
                      </Link>
                    </TD>
                    <TD>{(p.organizationId as unknown as { name?: string })?.name}</TD>
                    <TD>
                      <StatusBadge status={p.status} />
                    </TD>
                    <TD className="w-40">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${p.tasks.total ? (p.tasks.done / p.tasks.total) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-ink-500">
                          {p.tasks.done}/{p.tasks.total}
                        </span>
                      </div>
                    </TD>
                    <TD className="text-xs">{formatDate(p.dueDate)}</TD>
                    <TD className="text-xs text-ink-500">{(p.assignedStaff as unknown as { name: string }[]).map((s) => s.name).join(", ") || "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(pg) => withParams("/dashboard/projects", sp, { page: pg })} />
          </>
        )}
      </Card>
    </div>
  );
}
