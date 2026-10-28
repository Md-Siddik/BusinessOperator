import { route, searchParamsObject } from "@/lib/api/handler";
import { exportOldCompanies, oldCompanyQuerySchema } from "@/features/established/service";

/** CSV export of the filtered Old company Intelligence list (companies.export; audited). */
export const GET = route({ internal: true, permission: "companies.export", rateLimit: { bucket: "export", limit: 30, windowMs: 60 * 60_000 } }, async ({ req, actor }) => {
  const params = searchParamsObject(req);
  const q = oldCompanyQuerySchema.parse(params);
  const { csv, rows, truncated } = await exportOldCompanies(actor, params);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="old-company-intelligence-${q.country.toLowerCase()}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows),
      "X-Export-Truncated": String(truncated),
    },
  });
});
