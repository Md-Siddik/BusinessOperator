import { readJson, route } from "@/lib/api/handler";
import { createEmployerFeed, listFeeds } from "@/features/opportunities/service";

/** Provider configuration and employer feeds (owner only). Credentials are never returned — env var names only. */
export const GET = route({ ownerOnly: true }, async ({ actor }) => listFeeds(actor));
export const POST = route({ ownerOnly: true }, async ({ req, actor }) => createEmployerFeed(actor, await readJson(req)));
