import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { formatDate, formatRelative, humanize } from "@/lib/utils/format";
import type { SupportTicketDoc } from "@/models";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { DescriptionList, Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { TicketControls, TicketConversation } from "./ticket-views";

type TicketRow = Pick<SupportTicketDoc, "_id" | "number" | "title" | "status" | "priority" | "kind" | "requestType" | "updatedAt" | "isDemo"> & {
  organizationId?: { name?: string } | unknown;
  assignedTo?: { name?: string } | unknown;
};

/** Ticket/request table shared by the dashboard and the client portal. */
export function TicketTable({ rows, hrefBase, showClient }: { rows: TicketRow[]; hrefBase: (t: TicketRow) => string; showClient: boolean }) {
  if (!rows.length) return <EmptyState icon={LifeBuoy} title="Nothing here yet" />;
  return (
    <Table>
      <THead>
        <tr>
          <TH>#</TH>
          <TH>Title</TH>
          {showClient && <TH>Client</TH>}
          <TH>Type</TH>
          <TH>Priority</TH>
          <TH>Status</TH>
          <TH>Assigned</TH>
          <TH>Updated</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((t) => (
          <TR key={String(t._id)}>
            <TD className="tabular-nums text-ink-400">{t.number}</TD>
            <TD className="max-w-80">
              <Link href={hrefBase(t)} className="font-medium text-ink-900 hover:text-brand-700">
                {t.title}
              </Link>
              {t.isDemo && <DemoBadge label="Demo" className="ml-2" />}
            </TD>
            {showClient && <TD>{(t.organizationId as { name?: string } | null)?.name}</TD>}
            <TD className="text-xs text-ink-600">{t.kind === "REQUEST" ? humanize(t.requestType ?? "OTHER") : "Support ticket"}</TD>
            <TD>
              <StatusBadge status={t.priority} />
            </TD>
            <TD>
              <StatusBadge status={t.status} />
            </TD>
            <TD className="text-xs text-ink-600">{(t.assignedTo as { name?: string } | null)?.name ?? "—"}</TD>
            <TD className="whitespace-nowrap text-xs text-ink-500">{formatRelative(t.updatedAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

type FullTicket = SupportTicketDoc & {
  organizationId: { _id: string; name: string } | unknown;
  assignedTo?: { _id: string; name: string } | unknown;
  createdBy?: { name: string } | unknown;
};

export function TicketDetail({ ticket, mode, staff = [], canAssign = false }: { ticket: FullTicket; mode: "client" | "internal"; staff?: { id: string; name: string }[]; canAssign?: boolean }) {
  const org = ticket.organizationId as unknown as { _id: string; name: string };
  const assignee = ticket.assignedTo as unknown as { _id: string; name: string } | null | undefined;
  const comments = ticket.comments.map((c) => ({
    _id: String(c._id),
    body: c.body ?? "",
    internal: !!c.internal,
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : "",
    author: c.authorId && typeof c.authorId === "object" && "name" in (c.authorId as object) ? (c.authorId as unknown as { name: string; role: string }) : undefined,
  }));
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Description" description={`Opened by ${(ticket.createdBy as { name?: string } | null)?.name ?? "—"} · ${formatDate(ticket.createdAt)}`} />
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{ticket.description}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Conversation" />
          <CardContent>
            <TicketConversation ticketId={String(ticket._id)} comments={comments} attachments={ticket.attachments.map((a) => ({ _id: String(a._id), name: a.name, size: a.size ?? undefined }))} mode={mode} closed={ticket.status === "CLOSED" && mode === "client"} />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardContent className="space-y-5">
            <DescriptionList
              items={[
                { label: "Type", value: ticket.kind === "REQUEST" ? humanize(ticket.requestType ?? "OTHER") : "Support ticket" },
                ...(mode === "internal" ? [{ label: "Client", value: <Link className="text-brand-700" href={`/dashboard/clients/${org._id}`}>{org.name}</Link> }] : []),
                { label: "Status", value: <StatusBadge status={ticket.status} /> },
                { label: "Priority", value: <StatusBadge status={ticket.priority} /> },
                { label: "Assigned staff", value: assignee?.name ?? "Not yet assigned" },
                { label: "Due", value: formatDate(ticket.dueDate) },
                { label: "Resolved", value: formatDate(ticket.resolvedAt) },
              ]}
            />
            <TicketControls ticketId={String(ticket._id)} status={ticket.status} priority={ticket.priority} assignedTo={assignee?._id ? String(assignee._id) : undefined} staff={staff} mode={mode} canAssign={canAssign} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
