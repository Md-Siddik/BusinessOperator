import { ShieldCheck } from "lucide-react";
import { requireInternalPage } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/format";
import { listSuppressions } from "@/features/outreach/suppression";
import { resolveCountry } from "@/features/site/country-context";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, withParams } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { OutreachTabs } from "@/components/app/section-tabs";
import { RemoveSuppression, SuppressionForm } from "@/components/app/outreach-forms";

export const metadata = { title: "Suppression list" };

export default async function SuppressionPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requireInternalPage("outreach.manage");
  const sp = await searchParams;
  const ctx = await resolveCountry();
  const result = await listSuppressions(actor, { q: sp.q, page: Number(sp.page ?? 1) || 1 });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Outreach · Compliance" title="Suppression list" description="Addresses and domains that must never receive outreach. Checked before approval and again before every send. Opt-outs from unsubscribe links land here automatically." />
      <OutreachTabs active="suppression" country={ctx.code} />
      <Card>
        <CardHeader title="Add entry" />
        <SuppressionForm />
      </Card>
      <Card>
        <form method="get" className="p-5">
          <Input name="q" defaultValue={sp.q} placeholder="Search email or domain" aria-label="Search suppression list" className="max-w-sm" />
        </form>
        {result.items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No entries" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Email / domain</TH>
                  <TH>Reason</TH>
                  <TH>Source</TH>
                  <TH>Added</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {result.items.map((s) => (
                  <TR key={String(s._id)}>
                    <TD className="font-medium">{s.email ?? `*@${s.domain}`}</TD>
                    <TD>
                      <Badge tone={s.reason === "OPT_OUT" || s.reason === "DO_NOT_CONTACT" ? "danger" : "neutral"}>{s.reason.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TD>
                    <TD className="text-ink-500">
                      {s.source}
                      {s.note && ` · ${s.note}`}
                    </TD>
                    <TD className="text-xs text-ink-500">{formatDate(s.createdAt)}</TD>
                    <TD className="text-right">{can(actor, "outreach.approve") && <RemoveSuppression id={String(s._id)} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} buildHref={(p) => withParams("/dashboard/outreach/suppression", sp, { page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
