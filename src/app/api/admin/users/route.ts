import { readJson, route } from "@/lib/api/handler";
import { createInternalUser, listInternalUsersAdmin } from "@/features/users/service";

export const GET = route({ internal: true }, async ({ req, actor }) => listInternalUsersAdmin(actor, { q: req.nextUrl.searchParams.get("q") ?? undefined }));
export const POST = route({ internal: true }, async ({ req, actor }) => createInternalUser(actor, await readJson(req)));
