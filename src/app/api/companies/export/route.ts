import { route, searchParamsObject } from "@/lib/api/handler";
import { exportCompanies } from "@/features/companies/registrations";

/** CSV export of the filtered company list (permission companies.export; audited). */
export const GET = route({ internal: true, permission: "companies.export", rateLimit: { bucket: "export", limit: 30, windowMs: 60 * 60_000 } }, async ({ req, actor }) => {
  const params: Record<string, string> = { range: "today", ...searchParamsObject(req) };
  const { csv, rows, truncated } = await exportCompanies(actor, params);
  const name = `companies-${String(params.country ?? "all").toLowerCase()}-${params.range}${params.from ? `-${params.from}` : ""}.csv`;
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
