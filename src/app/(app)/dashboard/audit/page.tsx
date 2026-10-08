import { requireInternalPage } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { listAuditLogs } from "@/features/users/service";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";

export const metadata = { title: "Audit log" };

const ACTION_GROUPS = ["auth", "user", "client", "company", "crm", "email", "campaign", "template", "registry", "settings", "country", "chat", "ticket", "project", "document", "suppression", "translation", "content"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; q?: string; page?: string }> }) {
  const actor = await requireInternalPage("audit.view");
  const sp = await searchParams;
  const result = await listAuditLogs(actor, { action: sp.action, q: sp.q, page: Number(sp.page ?? 1) || 1 });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="Audit log" description="Logins, user and role changes, client approvals, CRM stage changes, email approvals and sends, campaigns, registry syncs, settings and important chat/admin actions." />
      <Card>
        <form method="get" className="flex flex-col gap-3 p-5 sm:flex-row">
          <Select name="action" defaultValue={sp.action ?? ""} aria-label="Action" className="sm:w-56">
            <option value="">All actions</option>
            {ACTION_GROUPS.map((a) => (
              <option key={a} value={`${a}.`}>
                {a}.*
              </option>
            ))}
          </Select>
          <Input name="q" defaultValue={sp.q} placeholder="Actor email or entity id" aria-label="Search" className="sm:flex-1" />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        <Table>
          <THead>
            <tr>
              <TH>Time</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Details</TH>
            </tr>
          </THead>
          <TBody>
            {result.items.map((a) => (
              <TR key={String(a._id)}>
                <TD className="whitespace-nowrap text-xs tabular-nums text-ink-500">{formatDateTime(a.createdAt)}</TD>
                <TD className="text-xs">
                  {a.actorEmail ?? "System"}
                  {a.actorRole && <span className="ml-1 text-ink-400">({a.actorRole.toLowerCase()})</span>}
                </TD>
                <TD>
                  <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs">{a.action}</code>
                </TD>
                <TD className="text-xs text-ink-500">
                  {a.entityType}
                  {a.countryCode && ` · ${a.countryCode}`}
                </TD>
                <TD className="max-w-96 truncate font-mono text-[11px] text-ink-500">{a.metadata ? JSON.stringify(a.metadata) : ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams("/dashboard/audit", sp, { page: p })} />
      </Card>
    </div>
  );
}
