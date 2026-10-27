import { route } from "@/lib/api/handler";
import { deleteIntelCompany, getIntelDetail } from "@/features/companies/intel";

type P = { id: string };

/** One company with the evidence behind every contact value (companies.read). */
export const GET = route<P>({ team: true, permission: "companies.read" }, async ({ actor, params }) => getIntelDetail(actor, params.id));

/** Remove a company record and suppress its email addresses (companies.delete; audited). */
export const DELETE = route<P>({ team: true, permission: "companies.delete" }, async ({ actor, params }) => deleteIntelCompany(actor, params.id));
