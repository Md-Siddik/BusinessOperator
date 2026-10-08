import { route } from "@/lib/api/handler";
import { listQuotations } from "@/features/quotations/service";

export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => listQuotations(actor, { companyId: req.nextUrl.searchParams.get("companyId") ?? undefined }));
