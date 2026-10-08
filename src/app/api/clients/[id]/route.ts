import { readJson, route } from "@/lib/api/handler";
import { getOrganizationOverview, updateOrganization } from "@/features/clients/service";

type P = { id: string };
/** Clients may only read/update their own organization — enforced in the service (others → 404). */
export const GET = route<P>({}, async ({ actor, params }) => getOrganizationOverview(actor, params.id));
export const PATCH = route<P>({}, async ({ req, actor, params }) => {
  await updateOrganization(actor, params.id, await readJson(req));
  return { ok: true };
});
