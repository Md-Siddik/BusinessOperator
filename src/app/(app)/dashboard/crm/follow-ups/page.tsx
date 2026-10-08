import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { dispatchDueFollowUpReminders, listFollowUps } from "@/features/crm/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { CrmTabs } from "@/components/app/section-tabs";
import { StageBadge } from "@/components/app/company-table";
import { FollowUpDone } from "@/components/app/company-actions";

export const metadata = { title: "Follow-ups" };

type Row = { _id: string; dueAt: string; type: string; notes?: string; companyId?: { _id: string; companyName: string; countryCode: string; lead?: { stage?: string } } | null; assignedTo?: { name: string } | null };

function FollowUpList({ rows, tone }: { rows: Row[]; tone: "overdue" | "today" | "upcoming" }) {
  if (!rows.length) return <p className="px-5 py-6 text-sm text-ink-500">Nothing here.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((f) => (
        <li key={String(f._id)} className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            {f.companyId ? (
              <Link href={`/dashboard/companies/${f.companyId.countryCode.toLowerCase()}/${f.companyId._id}`} className="font-medium text-ink-900 hover:text-brand-700">
                {f.companyId.companyName}
              </Link>
            ) : (
              <span className="text-ink-500">Deleted company</span>
            )}
            <p className="text-xs text-ink-500">
              <span className={tone === "overdue" ? "font-medium text-red-600" : ""}>{formatDateTime(f.dueAt)}</span> · {f.type.toLowerCase()} · {f.assignedTo?.name ?? "Unassigned"}
              {f.notes && ` · ${f.notes}`}
            </p>
          </div>
          {f.companyId?.lead?.stage && <StageBadge stage={f.companyId.lead.stage} />}
          <FollowUpDone id={String(f._id)} />
        </li>
      ))}
    </ul>
  );
}

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const actor = await requireInternalPage("companies.read");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  await dispatchDueFollowUpReminders().catch(() => 0);
  const [overdue, today, upcoming] = (await Promise.all([
    listFollowUps(actor, { country: ctx.code, bucket: "overdue" }),
    listFollowUps(actor, { country: ctx.code, bucket: "today" }),
    listFollowUps(actor, { country: ctx.code, bucket: "upcoming" }),
  ])) as unknown as Row[][];
  const empty = !overdue.length && !today.length && !upcoming.length;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="CRM" title={`Follow-ups · ${ctx.country?.name ?? "All Countries"}`} description="Your follow-ups (or the whole team's with lead management permission)." />
      <CrmTabs active="follow-ups" country={ctx.code} />
      {empty ? (
        <Card>
          <EmptyState icon={CalendarCheck} title="No open follow-ups" description="Schedule follow-ups from a company's profile." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader title={`Overdue (${overdue.length})`} />
            <FollowUpList rows={overdue} tone="overdue" />
          </Card>
          <Card>
            <CardHeader title={`Today (${today.length})`} />
            <FollowUpList rows={today} tone="today" />
          </Card>
          <Card>
            <CardHeader title={`Upcoming (${upcoming.length})`} />
            <FollowUpList rows={upcoming} tone="upcoming" />
          </Card>
        </div>
      )}
    </div>
  );
}
