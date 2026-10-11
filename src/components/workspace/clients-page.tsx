import Link from "next/link";
import { Building2, Inbox } from "lucide-react";
import { countryName } from "@/config/countries";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate, humanize } from "@/lib/utils/format";
import { Organization } from "@/models";
import { listOrganizations } from "@/features/clients/service";
import { listContactRequests } from "@/features/content/service";
import { Card } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { LinkTabs, PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { InquiryStatus } from "@/components/app/client-admin";

const ENGAGEMENT_LABELS: Record<string, string> = { monthly: "Monthly partnership", growth: "Growth partnership", project: "Task-based", notSure: "Not sure yet" };

export async function ClientsPage({ base, searchParams }: { base: WorkspaceBase; searchParams: Promise<{ tab?: string; status?: string; q?: string; page?: string }> }) {
  const actor = await requireWorkspacePage(base);
  const sp = await searchParams;
  const tab = sp.tab === "inquiries" && can(actor, "clients.manage") ? "inquiries" : "clients";
  const pendingCount = await Organization.countDocuments({ status: "PENDING_APPROVAL" });
  const tabs = [
    { id: "clients", label: "Clients", href: `${base}/clients` },
    ...(can(actor, "clients.manage") ? [{ id: "pending", label: "Awaiting approval", href: `${base}/clients?status=PENDING_APPROVAL`, count: pendingCount }, { id: "inquiries", label: "Website enquiries", href: `${base}/clients?tab=inquiries` }] : []),
  ];
  const activeTab = tab === "inquiries" ? "inquiries" : sp.status === "PENDING_APPROVAL" ? "pending" : "clients";

  if (tab === "inquiries") {
    const inquiries = await listContactRequests(actor, { status: sp.status, page: Number(sp.page ?? 1) || 1 });
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Clients" title="Website enquiries" description="Submissions from the public contact form." />
        <LinkTabs active={activeTab} tabs={tabs} />
        <Card>
          {inquiries.items.length === 0 ? (
            <EmptyState icon={Inbox} title="No enquiries yet" />
          ) : (
            <>
              <ul className="divide-y divide-ink-100">
                {inquiries.items.map((r) => (
                  <li key={String(r._id)} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-900">
                        {r.company || r.name} {r.isDemo && <DemoBadge label="Demo" className="ml-1" />}
                      </p>
                      <p className="text-xs text-ink-500">
                        {r.name} · <a className="text-brand-700" href={`mailto:${r.email}`}>{r.email}</a>
                        {r.phone && ` · ${r.phone}`} · {countryName(r.countryCode)} · {r.industry ? INDUSTRY_LABELS[r.industry as IndustryKey] : "—"} · prefers {r.preferredContact ?? "email"} · {r.locale?.toUpperCase()}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{r.message}</p>
                      <p className="mt-2 text-xs text-ink-500">
                        Need: {r.need ? humanize(r.need) : "—"}
                        {r.engagement && ` · Engagement: ${ENGAGEMENT_LABELS[r.engagement] ?? r.engagement}`}
                        {r.budget && ` · Budget: ${r.budget}`}
                        {r.ongoingSupport && ` · Ongoing support: ${r.ongoingSupport}`}
                        {r.interestedServices.length > 0 && ` · Interested in: ${r.interestedServices.join(", ")}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-400">{formatDate(r.createdAt)}</span>
                      <InquiryStatus id={String(r._id)} status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination page={inquiries.page} pageCount={inquiries.pageCount} total={inquiries.total} buildHref={(p) => withParams(`${base}/clients`, sp, { page: p })} />
            </>
          )}
        </Card>
      </div>
    );
  }

  const result = await listOrganizations(actor, { q: sp.q, status: sp.status, page: Number(sp.page ?? 1) || 1 });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Clients" title="Client organizations" description="Every client is an isolated organization — users, services, projects, requests, documents and conversations all belong to it." />
      <LinkTabs active={activeTab} tabs={tabs} />
      <Card>
        <form method="get" className="flex flex-col gap-3 p-5 sm:flex-row">
          <Input name="q" defaultValue={sp.q} placeholder="Search clients" aria-label="Search clients" className="sm:flex-1" />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="sm:w-52">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {result.items.length === 0 ? (
          <EmptyState icon={Building2} title="No clients found" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH>Country</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Active services</TH>
                  <TH className="text-right">Open tickets</TH>
                  <TH className="text-right">Users</TH>
                  <TH>Account manager</TH>
                  <TH>Since</TH>
                </tr>
              </THead>
              <TBody>
                {result.items.map((o) => (
                  <TR key={String(o._id)}>
                    <TD>
                      <Link href={`${base}/clients/${o._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                        {o.name}
                      </Link>
                      <p className="text-xs text-ink-500">{o.industry ? INDUSTRY_LABELS[o.industry as IndustryKey] : ""}</p>
                    </TD>
                    <TD>{countryName(o.countryCode)}</TD>
                    <TD>
                      <StatusBadge status={o.status} />
                    </TD>
                    <TD className="text-right tabular-nums">{o.activeServices}</TD>
                    <TD className="text-right tabular-nums">{o.openTickets}</TD>
                    <TD className="text-right tabular-nums">{o.userCount}</TD>
                    <TD className="text-ink-600">{(o.accountManagerId as unknown as { name?: string })?.name ?? "—"}</TD>
                    <TD className="text-xs text-ink-500">{formatDate(o.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams(`${base}/clients`, sp, { page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
