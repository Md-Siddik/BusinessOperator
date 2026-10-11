import { route } from "@/lib/api/handler";
import { listSyncRuns } from "@/features/opportunities/service";

export const GET = route({ ownerOnly: true }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return listSyncRuns(actor, { feedId: sp.get("feed") ?? undefined, limit: Number(sp.get("limit")) || 100, failedOnly: sp.get("failed") === "true" });
});
