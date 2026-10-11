import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { Organization } from "@/models";
import { getProject } from "@/features/projects/service";
import { listInternalUsers } from "@/features/crm/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/data";
import { ProjectEditor } from "@/components/app/client-admin";
import { ProjectTasks } from "@/components/app/project-tasks";

export async function ProjectDetailPage({ base, params }: { base: WorkspaceBase; params: Promise<{ id: string }> }) {
  const actor = await requireWorkspacePage(base);
  const { id } = await params;
  let data;
  try {
    data = await getProject(actor, id);
  } catch {
    notFound();
  }
  const { project: p, tasks } = data;
  const [staff, orgs] = await Promise.all([listInternalUsers(), Organization.find().select("name").lean<{ _id: unknown; name: string }[]>()]);
  const org = p.organizationId as unknown as { _id: string; name: string };
  const team = p.assignedStaff as unknown as { _id: string; name: string }[];
  return (
    <div className="space-y-6">
      <Link href={`${base}/projects`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Projects
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link href={`${base}/clients/${org._id}`} className="hover:text-ink-800">
              {org.name}
            </Link>
            <StatusBadge status={p.status} /> {p.isDemo && <DemoBadge />}
          </span>
        }
        title={p.name}
        description={p.description ?? undefined}
        actions={
          can(actor, "projects.manage") ? (
            <ProjectEditor
              orgs={orgs.map((o) => ({ id: String(o._id), name: o.name }))}
              staff={staff.map((s) => ({ id: String(s._id), name: s.name }))}
              project={{ id: String(p._id), organizationId: String(org._id), name: p.name, description: p.description ?? undefined, status: p.status, startDate: p.startDate?.toISOString(), dueDate: p.dueDate?.toISOString(), assignedStaff: team.map((s) => String(s._id)) }}
            />
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Tasks" description={`${tasks.filter((t) => t.status === "DONE").length} of ${tasks.length} done`} />
          <ProjectTasks
            projectId={String(p._id)}
            canManage
            staff={staff.map((s) => ({ id: String(s._id), name: s.name }))}
            tasks={tasks.map((t) => ({ id: String(t._id), title: t.title, status: t.status, dueDate: t.dueDate?.toISOString(), assignee: (t.assigneeId as unknown as { name?: string })?.name, visibleToClient: t.visibleToClient }))}
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Start", value: formatDate(p.startDate) },
                  { label: "Due", value: formatDate(p.dueDate) },
                  { label: "Team", value: team.map((s) => s.name).join(", ") || "—" },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ul className="divide-y divide-ink-100">
              {[...p.activity].reverse().map((a, i) => (
                <li key={i} className="px-5 py-2.5 text-sm">
                  <p>{a.text}</p>
                  <p className="text-xs text-ink-400">
                    {(a.actorId as unknown as { name?: string })?.name ?? "System"} · {formatRelative(a.at)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
