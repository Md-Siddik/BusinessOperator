import { requireTeamPage } from "@/lib/auth/session";
import { listMarketerLeads } from "@/features/marketer/service";
import { MarketerLeadsTable, type MarketerLeadPage } from "@/components/marketer/marketer-leads-table";

export const metadata = { title: "Client leads" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * The shared marketer table (every lead the Owner sent). Requires "View Marketer Table" (checked
 * here, in the API and in the service). Digital Marketers set outreach statuses; Admins read only.
 */
export default async function ClientLeadsPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireTeamPage("marketerLeads.view");
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const initial = await listMarketerLeads(actor, { q: pick("q"), type: pick("type"), sort: pick("sort"), dir: pick("dir"), page: pick("page") }).catch(() => listMarketerLeads(actor, {}));
  return <MarketerLeadsTable initial={JSON.parse(JSON.stringify(initial)) as MarketerLeadPage} readOnly={actor.role !== "DIGITAL_MARKETER"} />;
}
