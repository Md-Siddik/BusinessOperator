import { readJson, route } from "@/lib/api/handler";
import { savePackage } from "@/features/service-fit/service";

type P = { id: string };

export const PATCH = route<P>({ internal: true, permission: "settings.manage" }, async ({ req, actor, params }) => savePackage(actor, params.id, await readJson(req)));
