import Link from "next/link";
import { countryName } from "@/config/countries";
import { formatDate } from "@/lib/utils/format";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/data";

export type OutreachRow = {
  _id: unknown;
  to: string;
  subject: string;
  status: string;
  replyStatus?: string;
  countryCode?: string;
  createdAt: Date | string;
  sentAt?: Date | string | null;
  simulated?: boolean;
  isDemo?: boolean;
  companyId?: { companyName?: string } | null;
  campaignId?: { name?: string } | null;
  createdBy?: { name?: string } | null;
  approvedBy?: { name?: string } | null;
};

export function OutreachMessageTable({ rows }: { rows: OutreachRow[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Company · Recipient</TH>
          <TH>Subject</TH>
          <TH>Campaign</TH>
          <TH>Status</TH>
          <TH>Author · Approver</TH>
          <TH>Date</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((m) => (
          <TR key={String(m._id)}>
            <TD>
              <p className="font-medium text-ink-900">{m.companyId?.companyName ?? "—"}</p>
              <p className="text-xs text-ink-500">
                {m.to} · {countryName(m.countryCode)}
              </p>
            </TD>
            <TD className="max-w-72">
              <Link href={`/dashboard/outreach/messages/${m._id}`} className="line-clamp-2 hover:text-brand-700">
                {m.subject}
              </Link>
            </TD>
            <TD className="text-ink-500">{m.campaignId?.name ?? "Individual"}</TD>
            <TD>
              <span className="flex flex-wrap gap-1">
                <StatusBadge status={m.status} />
                {m.replyStatus === "REPLIED" && <Badge tone="violet">Replied</Badge>}
                {m.simulated && <Badge tone="warning">Simulated</Badge>}
                {m.isDemo && <DemoBadge label="Demo" />}
              </span>
            </TD>
            <TD className="text-xs text-ink-500">
              {m.createdBy?.name ?? "—"}
              {m.approvedBy?.name ? ` · ${m.approvedBy.name}` : ""}
            </TD>
            <TD className="whitespace-nowrap text-xs text-ink-500">{formatDate(m.sentAt ?? m.createdAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
