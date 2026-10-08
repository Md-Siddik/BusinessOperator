import { readJson, route } from "@/lib/api/handler";
import { getQuotation, updateQuotation } from "@/features/quotations/service";

type P = { id: string };

export const GET = route<P>({ internal: true, permission: "companies.read" }, async ({ actor, params }) => getQuotation(actor, params.id));
export const PATCH = route<P>({ internal: true, permission: "companies.read" }, async ({ req, actor, params }) => updateQuotation(actor, params.id, await readJson(req)));
