import { Inbox } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { listOutreachMessages } from "@/features/outreach/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Pagination, withParams } from "@/components/ui/data";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { OutreachTabs } from "@/components/app/section-tabs";
import { OutreachMessageTable, type OutreachRow } from "@/components/app/message-list";

export const metadata = { title: "Email queue" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ country?: string; page?: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const page = Number(sp.page ?? 1) || 1;
  const [pending, approved, drafts] = await Promise.all([
    listOutreachMessages(actor, { country: ctx.code, status: "PENDING_APPROVAL", page }),
    listOutreachMessages(actor, { country: ctx.code, status: "APPROVED" }),
    listOutreachMessages(actor, { country: ctx.code, status: "DRAFT" }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Outreach" title={`Email queue · ${ctx.country?.name ?? "All Countries"}`} description="Every outreach email is reviewed by a person. Suppression is checked at approval and again at send." />
      <OutreachTabs active="queue" country={ctx.code} pending={pending.total} />
      {!can(actor, "outreach.approve") && <Alert tone="info">You can prepare and submit drafts. A colleague with approval rights reviews and sends them.</Alert>}
      <Card>
        <CardHeader title={`Awaiting review (${pending.total})`} />
        {pending.items.length ? (
          <>
            <OutreachMessageTable rows={pending.items as unknown as OutreachRow[]} />
            <Pagination page={pending.page} pageCount={pending.pageCount} total={pending.total} buildHref={(p) => withParams("/dashboard/outreach/queue", { country: ctx.code }, { page: p })} />
          </>
        ) : (
          <EmptyState icon={Inbox} title="Nothing awaiting review" />
        )}
      </Card>
      <Card>
        <CardHeader title={`Approved — ready to send (${approved.total})`} />
        {approved.items.length ? <OutreachMessageTable rows={approved.items as unknown as OutreachRow[]} /> : <p className="px-5 py-4 text-sm text-ink-500">No approved messages waiting.</p>}
      </Card>
      <Card>
        <CardHeader title={`Drafts (${drafts.total})`} description="Edit and submit drafts for review." />
        {drafts.items.length ? <OutreachMessageTable rows={drafts.items as unknown as OutreachRow[]} /> : <p className="px-5 py-4 text-sm text-ink-500">No drafts.</p>}
      </Card>
    </div>
  );
}
