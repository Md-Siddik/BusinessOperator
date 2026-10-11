import { readJson, route } from "@/lib/api/handler";
import { deleteEmployerFeed, updateFeed } from "@/features/opportunities/service";

type P = { id: string };

export const PATCH = route<P>({ ownerOnly: true }, async ({ req, actor, params }) => updateFeed(actor, params.id, await readJson(req)));
export const DELETE = route<P>({ ownerOnly: true }, async ({ actor, params }) => deleteEmployerFeed(actor, params.id));
