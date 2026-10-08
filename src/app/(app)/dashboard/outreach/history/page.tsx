import { Mail } from "lucide-react";
import { EMAIL_STATUSES } from "@/lib/constants";
import { requireInternalPage } from "@/lib/auth/session";
import { listOutreachMessages } from "@/features/outreach/service";
import { resolveCountry } from "@/features/site/country-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { PageHeader, Pagination, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { OutreachTabs } from "@/components/app/section-tabs";
import { OutreachMessageTable, type OutreachRow } from "@/components/app/message-list";

export const metadata = { title: "Email history" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ country?: string; status?: string; page?: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const sp = await searchParams;
  const ctx = await resolveCountry(sp.country);
  const result = await listOutreachMessages(actor, { country: ctx.code, status: sp.status, page: Number(sp.page ?? 1) || 1 });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Outreach" title={`Email history · ${ctx.country?.name ?? "All Countries"}`} description="Complete, auditable record of outreach drafts, approvals, sends and replies." />
      <OutreachTabs active="history" country={ctx.code} />
      <Card>
        <form method="get" className="flex gap-3 p-5">
          <input type="hidden" name="country" value={ctx.code} />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-60">
            <option value="">All statuses</option>
            {[...EMAIL_STATUSES, "REPLIED"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {result.items.length ? (
          <>
            <OutreachMessageTable rows={result.items as unknown as OutreachRow[]} />
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams("/dashboard/outreach/history", { ...sp, country: ctx.code }, { page: p })} />
          </>
        ) : (
          <EmptyState icon={Mail} title="No messages" />
        )}
      </Card>
    </div>
  );
}
