import Link from "next/link";
import { ArrowRight, Lock, Radar, Users } from "lucide-react";
import { requireTeamPage } from "@/lib/auth/session";
import { can, isDigitalMarketer, isInternal } from "@/lib/permissions";
import { teamNavigation } from "@/lib/permissions/navigation";
import { formatDate } from "@/lib/utils/format";
import { getClientSummary } from "@/features/clients/summary";
import { countMyLeads } from "@/features/marketer/service";
import { Card } from "@/components/ui/card";
import { KpiCard, PageHeader } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ClientSummarySection } from "@/components/workspace/client-summary";

export const metadata = { title: "Overview" };

/** Team workspace home: what this account has been granted — nothing else is shown or linked. */
export default async function StaffHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireTeamPage();
  const { denied } = await searchParams;
  const areas = teamNavigation(actor).filter((g) => g.id !== "home" && g.id !== "account");
  const marketer = isDigitalMarketer(actor);
  const leads = marketer && can(actor, "marketerLeads.view") ? await countMyLeads(actor) : null;
  const summary = isInternal(actor) ? await getClientSummary(actor) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={formatDate(new Date(), "EEEE d MMMM yyyy")}
        title={`Hello, ${actor.name.split(" ")[0]}`}
        description={marketer ? "Leads the Owner sends you and anything else you've been given access to." : "Client accounts, messages, requests and website content you maintain."}
      />
      {denied && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" role="alert">
          You don&apos;t have permission to open that page. Ask the Owner if you need access.
        </div>
      )}

      {marketer && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {leads ? (
            <KpiCard label="Client leads" value={leads.total} hint={`${leads.recent} sent in the last 7 days`} icon={Users} href="/staff/client-leads" tone="brand" />
          ) : (
            <Card className="flex items-start gap-3 p-5">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-400" aria-hidden />
              <div>
                <p className="font-medium text-ink-900">Client leads — no access yet</p>
                <p className="mt-1 text-sm text-ink-600">The Owner hasn&apos;t given you “View Assigned Client Leads”. Leads sent to you appear once access is granted.</p>
              </div>
            </Card>
          )}
          {can(actor, "opportunities.view") && (
            <Link href="/staff/opportunities" className="group flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-5 hover:border-brand-300">
              <Radar className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div className="flex-1">
                <p className="font-medium text-ink-900">Opportunity Intelligence</p>
                <p className="mt-1 text-sm text-ink-600">Verified hiring and procurement opportunities.</p>
              </div>
              <ArrowRight className="h-4 w-4 text-ink-400 group-hover:text-brand-600" aria-hidden />
            </Link>
          )}
        </div>
      )}

      {summary && <ClientSummarySection summary={summary} base="/staff" />}

      {!summary && !marketer && areas.length === 0 && <EmptyState icon={Lock} title="No areas shared with you yet" description="Ask the Owner to grant the access you need." />}
      {!summary && !marketer && areas.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {areas.flatMap((g) => g.items).map((i) => (
            <Link key={i.href} href={i.href} className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-medium text-ink-800 hover:border-brand-300">
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
