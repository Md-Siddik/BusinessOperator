import { route, searchParamsObject } from "@/lib/api/handler";
import { analyticsRange, exportAnalyticsCsv } from "@/features/website-analytics/service";

/** CSV export of website analytics (OWNER ONLY). No IP addresses, names or emails. */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => {
  const params = searchParamsObject(req);
  const { csv, rows, filename } = await exportAnalyticsCsv(actor, params.kind ?? "", analyticsRange(params));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows),
    },
  });
});
