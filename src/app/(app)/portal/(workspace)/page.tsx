import Link from "next/link";
import { ArrowRight, FileText, Folder, LifeBuoy, MessageSquare, Plus, Sparkles } from "lucide-react";
import { requireClientPage } from "@/lib/auth/session";
import { formatDate, formatRelative, humanize } from "@/lib/utils/format";
import { getOrganizationActivity, getOrganizationOverview } from "@/features/clients/service";
import { getAvailability, unreadConversationCount } from "@/features/chat/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { KpiCard, PageHeader } from "@/components/ui/data";

export const metadata = { title: "Overview" };

const ACTIVITY_TEXT: Record<string, string> = {
  "client.approved": "Workspace activated",
  "client.service_updated": "A service was updated",
  "client.service_requested": "A new service was requested",
  "document.uploaded": "A document was uploaded",
  "ticket.created": "A request or ticket was opened",
  "ticket.status_changed": "A request or ticket changed status",
  "project.created": "A project was created",
  "project.updated": "A project was updated",
  "chat.conversation_started": "A conversation was started",
};

export default async function PortalOverview() {
  const actor = await requireClientPage();
  const [overview, activity, unread, availability] = await Promise.all([
    getOrganizationOverview(actor, actor.organizationId!),
    getOrganizationActivity(actor, actor.organizationId!, 10),
    unreadConversationCount(actor),
    getAvailability(),
  ]);
  const { org, services, projects, tickets, documents } = overview;
  const active = services.filter((s) => s.status === "ACTIVE");
  const openTickets = tickets.filter((t) => ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"].includes(t.status));
  const waiting = tickets.filter((t) => t.status === "WAITING_FOR_CLIENT");
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Client workspace"
        title={`Welcome, ${actor.name.split(" ")[0]}`}
        description={`${org.name} · ${availability.text}`}
        actions={
          <>
            <ButtonLink href="/portal/requests/new" size="sm">
              <Plus className="h-4 w-4" aria-hidden /> New request
            </ButtonLink>
            <ButtonLink href="/portal/messages" size="sm" variant="outline">
              <MessageSquare className="h-4 w-4" aria-hidden /> Message the team
            </ButtonLink>
          </>
        }
      />
      {waiting.length > 0 && (
        <Link href={`/portal/${waiting[0]!.kind === "REQUEST" ? "requests" : "tickets"}/${waiting[0]!._id}`} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <LifeBuoy className="h-4 w-4" aria-hidden />
          <span className="flex-1">
            {waiting.length} item{waiting.length > 1 ? "s are" : " is"} waiting for your reply.
          </span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard label="Active services" value={active.length} icon={Sparkles} tone="success" href="/portal/services" />
        <KpiCard label="Open requests & tickets" value={openTickets.length} icon={LifeBuoy} href="/portal/requests" />
        <KpiCard label="Projects" value={projects.filter((p) => p.status !== "COMPLETED").length} icon={Folder} href="/portal/projects" />
        <KpiCard label="Unread conversations" value={unread} icon={MessageSquare} tone="brand" href="/portal/messages" />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Your services" action={<Link href="/portal/services" className="text-sm text-brand-700">All services</Link>} />
          <ul className="divide-y divide-ink-100">
            {services.slice(0, 6).map((s) => (
              <li key={String(s._id)} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-2 text-xs text-ink-500">{humanize(s.category.replace(/-/g, "_"))}</span>
                </span>
                <StatusBadge status={s.status} />
              </li>
            ))}
            {services.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No services yet — request one from the Services page.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <ul className="divide-y divide-ink-100">
            {activity.map((a) => (
              <li key={String(a._id)} className="px-5 py-2.5 text-sm">
                <p>{ACTIVITY_TEXT[a.action] ?? humanize(a.action.replace(".", "_"))}</p>
                <p className="text-xs text-ink-400">{formatRelative(a.createdAt)}</p>
              </li>
            ))}
            {activity.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No activity yet.</li>}
          </ul>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Open requests & tickets" />
          <ul className="divide-y divide-ink-100">
            {openTickets.slice(0, 5).map((t) => (
              <li key={String(t._id)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`/portal/${t.kind === "REQUEST" ? "requests" : "tickets"}/${t._id}`} className="truncate hover:text-brand-700">
                  {t.title}
                </Link>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {openTickets.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">Nothing open.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Projects" />
          <ul className="divide-y divide-ink-100">
            {projects.slice(0, 5).map((p) => (
              <li key={String(p._id)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`/portal/projects/${p._id}`} className="truncate hover:text-brand-700">
                  {p.name}
                </Link>
                <span className="flex items-center gap-2 text-xs text-ink-500">
                  {p.dueDate && `due ${formatDate(p.dueDate)}`} <StatusBadge status={p.status} />
                </span>
              </li>
            ))}
            {projects.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No projects.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Documents" action={<Link href="/portal/documents" className="text-sm text-brand-700">All</Link>} />
          <CardContent className="space-y-2">
            {documents.slice(0, 5).map((d) => (
              <a key={String(d._id)} href={`/api/documents/${d._id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm hover:text-brand-700">
                <FileText className="h-4 w-4 text-ink-400" aria-hidden /> <span className="truncate">{d.name}</span>
              </a>
            ))}
            {documents.length === 0 && <p className="text-sm text-ink-500">No documents yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
