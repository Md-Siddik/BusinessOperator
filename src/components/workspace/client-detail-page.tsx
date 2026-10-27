import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { countryName } from "@/config/countries";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { getLanguage } from "@/config/languages";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatBytes, formatDate, formatRelative, humanize } from "@/lib/utils/format";
import { getOrganizationActivity, getOrganizationOverview } from "@/features/clients/service";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/data";
import { AddClientUser, ClientServiceEditor, ClientUserActions, DocumentUpload, OrgStatusActions } from "@/components/app/client-admin";

export async function ClientDetailPage({ base, params }: { base: WorkspaceBase; params: Promise<{ id: string }> }) {
  const actor = await requireWorkspacePage(base, "clients.manage");
  const { id } = await params;
  let data;
  try {
    data = await getOrganizationOverview(actor, id);
  } catch {
    notFound();
  }
  const { org, users, services, projects, tickets, documents, conversations } = data;
  const activity = await getOrganizationActivity(actor, id, 15);
  const manage = can(actor, "clients.manage");
  const isOwner = actor.role === "OWNER";
  const manager = org.accountManagerId as unknown as { name?: string; email?: string } | null;

  return (
    <div className="space-y-6">
      <Link href={`${base}/clients`} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Clients
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Client organization <StatusBadge status={org.status} /> {org.isDemo && <DemoBadge />}
          </span>
        }
        title={org.name}
        actions={manage ? <OrgStatusActions id={String(org._id)} status={org.status} /> : null}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Company profile" />
          <CardContent>
            <DescriptionList
              items={[
                { label: "Country", value: countryName(org.countryCode) },
                { label: "Industry", value: org.industry ? INDUSTRY_LABELS[org.industry as IndustryKey] : "—" },
                { label: "Website", value: org.website ?? "—" },
                { label: "Phone", value: org.phone ?? "—" },
                { label: "Preferred language", value: getLanguage(org.preferredLanguage ?? "en").englishName },
                { label: "Account manager", value: manager?.name ?? "—" },
                { label: "Client since", value: formatDate(org.createdAt) },
                { label: "Linked intelligence record", value: org.companyId ? "Yes" : "No" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title={`Users (${users.length})`} action={manage ? <AddClientUser orgId={String(org._id)} /> : null} />
          <ul className="divide-y divide-ink-100">
            {users.map((u) => (
              <li key={String(u._id)} className="px-5 py-3 text-sm">
                <p className="flex items-center justify-between gap-2">
                  <span className="font-medium">{u.name}</span>
                  <StatusBadge status={u.status} />
                </p>
                <p className="text-xs text-ink-500">
                  {u.email} · last login {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "never"}
                </p>
                {isOwner && (
                  <div className="mt-2">
                    <ClientUserActions user={{ id: String(u._id), name: u.name }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Services" description="Active, pending, completed and requested" action={manage ? <ClientServiceEditor orgId={String(org._id)} /> : null} />
          <ul className="divide-y divide-ink-100">
            {services.map((s) => (
              <li key={String(s._id)} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {humanize(s.category.replace(/-/g, "_"))}
                    {s.notes && ` · ${s.notes}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={s.status} />
                  {manage && <ClientServiceEditor orgId={String(org._id)} service={{ id: String(s._id), category: s.category, name: s.name, status: s.status, notes: s.notes ?? undefined }} />}
                </div>
              </li>
            ))}
            {services.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No services yet.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Documents" action={manage ? <DocumentUpload orgId={String(org._id)} internal /> : null} />
          <ul className="divide-y divide-ink-100">
            {documents.map((d) => (
              <li key={String(d._id)} className="flex items-center gap-3 px-5 py-3 text-sm">
                <FileText className="h-4 w-4 text-ink-400" aria-hidden />
                <a href={`/api/documents/${d._id}`} className="min-w-0 flex-1 truncate font-medium text-ink-900 hover:text-brand-700" target="_blank" rel="noopener noreferrer">
                  {d.name}
                </a>
                <span className="text-xs text-ink-500">
                  {humanize(d.category)} · {d.size ? formatBytes(d.size) : ""} {!d.visibleToClient && "· internal"}
                </span>
              </li>
            ))}
            {documents.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No documents.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Projects" action={<Link href={`${base}/projects?organizationId=${org._id}`} className="text-sm text-brand-700">All</Link>} />
          <ul className="divide-y divide-ink-100">
            {projects.map((p) => (
              <li key={String(p._id)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`${base}/projects/${p._id}`} className="truncate font-medium hover:text-brand-700">
                  {p.name}
                </Link>
                <StatusBadge status={p.status} />
              </li>
            ))}
            {projects.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No projects.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Requests & tickets" action={<Link href={`${base}/tickets?organizationId=${org._id}`} className="text-sm text-brand-700">All</Link>} />
          <ul className="divide-y divide-ink-100">
            {tickets.map((t) => (
              <li key={String(t._id)} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`${base}/tickets/${t._id}`} className="truncate hover:text-brand-700">
                  <span className="text-ink-400">#{t.number}</span> {t.title}
                </Link>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {tickets.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No requests or tickets.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Conversations"
            action={
              <span className="flex items-center gap-3 text-sm">
                {/* Only this client's conversations, and a new message already addressed to them. */}
                <Link href={`${base}/messages?client=${org._id}`} className="text-brand-700 hover:underline">
                  Inbox
                </Link>
                <Link href={`${base}/messages?client=${org._id}&new=1`} className="font-medium text-brand-700 hover:underline">
                  New message
                </Link>
              </span>
            }
          />
          <ul className="divide-y divide-ink-100">
            {conversations.map((c) => (
              <li key={String(c._id)} className="px-5 py-3 text-sm">
                <Link href={`${base}/messages?client=${org._id}&c=${c._id}`} className="font-medium hover:text-brand-700">
                  {c.subject}
                </Link>
                <p className="text-xs text-ink-500">
                  {humanize(c.status)} · {formatRelative(c.lastMessageAt)}
                </p>
              </li>
            ))}
            {conversations.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No conversations.</li>}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Activity history" />
        <ul className="divide-y divide-ink-100">
          {activity.map((a) => (
            <li key={String(a._id)} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
              <span>
                <span className="font-medium">{a.actorEmail ?? "System"}</span> · {a.action.replace(/[._]/g, " ")}
              </span>
              <span className="text-xs text-ink-400">{formatRelative(a.createdAt)}</span>
            </li>
          ))}
          {activity.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">No activity recorded.</li>}
        </ul>
      </Card>
    </div>
  );
}
