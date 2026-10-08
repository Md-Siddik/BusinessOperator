import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireClientPage } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { getProject } from "@/features/projects/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/data";
import { ProjectTasks } from "@/components/app/project-tasks";

export const metadata = { title: "Project" };

export default async function PortalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClientPage();
  const { id } = await params;
  let data;
  try {
    data = await getProject(actor, id);
  } catch {
    notFound();
  }
  const { project: p, tasks } = data;
  const team = p.assignedStaff as unknown as { name: string }[];
  return (
    <div className="space-y-6">
      <Link href="/portal/projects" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Projects
      </Link>
      <PageHeader eyebrow={<StatusBadge status={p.status} />} title={p.name} description={p.description ?? undefined} />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Tasks" />
          <ProjectTasks projectId={String(p._id)} canManage={false} staff={[]} tasks={tasks.map((t) => ({ id: String(t._id), title: t.title, status: t.status, dueDate: t.dueDate?.toISOString(), assignee: (t.assigneeId as unknown as { name?: string })?.name, visibleToClient: true }))} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Start", value: formatDate(p.startDate) },
                  { label: "Due", value: formatDate(p.dueDate) },
                  { label: "Your team", value: team.map((s) => s.name).join(", ") || "—" },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ul className="divide-y divide-ink-100">
              {[...p.activity].reverse().slice(0, 15).map((a, i) => (
                <li key={i} className="px-5 py-2.5 text-sm">
                  <p>{a.text}</p>
                  <p className="text-xs text-ink-400">{formatRelative(a.at)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
