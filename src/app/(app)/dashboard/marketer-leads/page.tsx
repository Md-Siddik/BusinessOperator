import { requireOwnerPage } from "@/lib/auth/session";
import { listLeadAssignments } from "@/features/marketer/owner-table";
import { OwnerLeadsTable, type OwnerLeadPage } from "@/components/marketer/owner-leads-table";

export const metadata = { title: "Marketer leads" };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Owner: the Digital Marketer management table (edit, delete, history). Admins granted "Manage
 * Marketer Table" use the same table at /staff/marketer-table; this Owner page stays Owner-only.
 */
export default async function MarketerLeadsOwnerPage({ searchParams }: { searchParams: SP }) {
  const actor = await requireOwnerPage();
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const initial = await listLeadAssignments(actor, { q: pick("q"), outreach: pick("outreach"), status: pick("status"), page: pick("page") }).catch(() => listLeadAssignments(actor, {}));
  return <OwnerLeadsTable initial={JSON.parse(JSON.stringify(initial)) as OwnerLeadPage} />;
}
