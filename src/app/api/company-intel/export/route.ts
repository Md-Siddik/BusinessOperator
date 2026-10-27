import { route, searchParamsObject } from "@/lib/api/handler";
import { exportCompanies } from "@/features/companies/registrations";
import { directoryQuerySchema, toCompanyQueryInput } from "@/features/companies/intel";

/** CSV export of the filtered directory (companies.export; restricted / suppressed contacts withheld; audited). */
export const GET = route({ team: true, permission: "companies.export", rateLimit: { bucket: "export", limit: 30, windowMs: 60 * 60_000 } }, async ({ req, actor }) => {
  const q = directoryQuerySchema.parse(searchParamsObject(req));
  const { csv, rows, truncated } = await exportCompanies(actor, toCompanyQueryInput(q));
  const name = `company-intelligence-${q.country.toLowerCase()}${q.type ? `-${q.type}` : ""}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows),
      "X-Export-Truncated": String(truncated),
    },
  });
});
