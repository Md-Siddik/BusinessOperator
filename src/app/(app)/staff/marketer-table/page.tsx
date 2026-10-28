import { requireTeamPage } from "@/lib/auth/session";
import { listLeadAssignments } from "@/features/marketer/owner-table";
import { OwnerLeadsTable, type OwnerLeadPage } from "@/components/marketer/owner-leads-table";

export const metadata = { title: "Manage marketer table" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Digital Marketer management table in the team workspace, for Admins the Owner granted "Manage
 * Marketer Table" (checked here, in the API and in the service). Same data and component as the
 * Owner's /dashboard/marketer-leads.
 */
export default async function MarketerTableManagePage({ searchParams }: { searchParams: SP }) {
  const actor = await requireTeamPage("marketerTable.manage");
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const initial = await listLeadAssignments(actor, { q: pick("q"), outreach: pick("outreach"), status: pick("status"), page: pick("page") }).catch(() => listLeadAssignments(actor, {}));
  return <OwnerLeadsTable initial={JSON.parse(JSON.stringify(initial)) as OwnerLeadPage} />;
}
