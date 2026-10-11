import { route, searchParamsObject } from "@/lib/api/handler";
import { exportOpportunitiesCsv } from "@/features/opportunities/service";

/** CSV export of the filtered opportunity list (owner only; audited). */
export const GET = route({ ownerOnly: true, rateLimit: { bucket: "opp-export", limit: 30, windowMs: 60 * 60_000 } }, async ({ req, actor }) => {
  const { csv, rows, truncated } = await exportOpportunitiesCsv(actor, searchParamsObject(req));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="opportunities-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows),
      "X-Export-Truncated": String(truncated),
    },
  });
});
