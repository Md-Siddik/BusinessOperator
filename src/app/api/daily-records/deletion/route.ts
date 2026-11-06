import { route, readJson } from "@/lib/api/handler";
import { prepareDailyDeletion, advanceDailyDeletion } from "@/features/daily-records/deletion";

const guard = { ownerOnly: true, rateLimit: { bucket: "daily-deletion", limit: 30, windowMs: 60_000 } } as const;
export const POST = route(guard, async ({ actor, req }) => prepareDailyDeletion(actor, await readJson(req)));
export const PATCH = route(guard, async ({ actor, req }) => advanceDailyDeletion(actor, await readJson(req)));
