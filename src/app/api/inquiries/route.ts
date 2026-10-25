import { route } from "@/lib/api/handler";
import { listInquiries } from "@/features/inquiries/service";
export const GET = route({}, async ({ actor, req }) => listInquiries(actor, { q: req.nextUrl.searchParams.get("q") || undefined, status: req.nextUrl.searchParams.get("status") || undefined, page: Number(req.nextUrl.searchParams.get("page")) || 1 }));
