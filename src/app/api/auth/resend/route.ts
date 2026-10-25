import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { resendVerification } from "@/features/auth/verification";
export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.passwordReset }, async ({ req }) => resendVerification(await readJson(req)));
