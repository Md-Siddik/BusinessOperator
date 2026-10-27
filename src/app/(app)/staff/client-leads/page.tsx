import { requireTeamPage } from "@/lib/auth/session";
import { listMarketerLeads } from "@/features/marketer/service";
import { MarketerLeadsTable, type MarketerLeadPage } from "@/components/marketer/marketer-leads-table";

export const metadata = { title: "Client leads" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Digital Marketer: leads the Owner sent to this person. Requires "View Assigned Client Leads"
 * (checked here, in the API and in the service — which also scopes rows to this marketer).
 */
export default async function ClientLeadsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireTeamPage("marketerLeads.view");
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const initial = await listMarketerLeads(actor, { q: pick("q"), type: pick("type"), sort: pick("sort"), dir: pick("dir"), page: pick("page") }).catch(() => listMarketerLeads(actor, {}));
  return <MarketerLeadsTable initial={JSON.parse(JSON.stringify(initial)) as MarketerLeadPage} />;
}
