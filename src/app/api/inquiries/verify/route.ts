import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { verifyInquiryEmail } from "@/features/inquiries/service";
export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.login }, async ({ req }) => verifyInquiryEmail(await readJson(req)));
