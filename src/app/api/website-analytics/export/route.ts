import { route, searchParamsObject } from "@/lib/api/handler";
import { analyticsRange, exportAnalyticsCsv } from "@/features/website-analytics/service";
import { exportHistoryCsv } from "@/features/website-analytics/history";

/** CSV export of website analytics (OWNER ONLY). No IP addresses, names, emails or phone numbers. */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => {
  const params = searchParamsObject(req);
  const range = analyticsRange(params);
  const kind = params.kind ?? "";
  const { csv, rows, filename } = kind === "daily" || kind === "leads" ? await exportHistoryCsv(actor, kind, range) : await exportAnalyticsCsv(actor, kind, range);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows),
    },
  });
});
