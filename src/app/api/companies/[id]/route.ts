import { readJson, route } from "@/lib/api/handler";
import { deleteCompany, getCompanyDetail, updateCompany } from "@/features/companies/service";

type P = { id: string };

export const GET = route<P>({ internal: true, permission: "companies.read" }, async ({ actor, params }) => getCompanyDetail(actor, params.id));
export const PATCH = route<P>({ internal: true }, async ({ req, actor, params }) => updateCompany(actor, params.id, await readJson(req)));
export const DELETE = route<P>({ internal: true }, async ({ req, actor, params }) => {
  await deleteCompany(actor, params.id, { suppress: req.nextUrl.searchParams.get("suppress") === "true" });
  return { ok: true };
});
