import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { TICKET_STATUSES } from "@/lib/constants";
import { humanize } from "@/lib/utils/format";
import { Organization } from "@/models";
import { listTickets } from "@/features/tickets/service";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { LinkTabs, PageHeader, Pagination, withParams } from "@/components/ui/data";
import { TicketTable } from "@/components/tickets/ticket-pages";

export async function TicketsPage({ base, searchParams }: { base: WorkspaceBase; searchParams: Promise<{ kind?: string; status?: string; organizationId?: string; page?: string }> }) {
  const actor = await requireWorkspacePage(base);
  const sp = await searchParams;
  const result = await listTickets(actor, { ...sp, kind: sp.kind || undefined, status: sp.status || undefined });
  const orgName = sp.organizationId ? (await Organization.findById(sp.organizationId).select("name").lean<{ name: string }>())?.name : undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title={orgName ? `Requests & tickets · ${orgName}` : "Requests & tickets"}
        description={can(actor, "tickets.manage") ? "Client service requests and support tickets across all clients." : "Requests and tickets assigned to you."}
      />
      <LinkTabs
        active={sp.kind ?? "all"}
        tabs={[
          { id: "all", label: "All", href: withParams(`${base}/tickets`, sp, { kind: undefined, page: undefined }) },
          { id: "REQUEST", label: "Service requests", href: withParams(`${base}/tickets`, sp, { kind: "REQUEST", page: undefined }) },
          { id: "TICKET", label: "Support tickets", href: withParams(`${base}/tickets`, sp, { kind: "TICKET", page: undefined }) },
        ]}
      />
      <Card>
        <form method="get" className="flex gap-3 p-5">
          {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
          {sp.organizationId && <input type="hidden" name="organizationId" value={sp.organizationId} />}
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-56">
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        <TicketTable rows={result.items as never} hrefBase={(t) => `${base}/tickets/${t._id}`} showClient />
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams(`${base}/tickets`, sp, { page: p })} />
      </Card>
    </div>
  );
}
