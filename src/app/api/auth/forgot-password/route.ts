import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { requestPasswordReset } from "@/features/auth/service";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.passwordReset }, async ({ req, ip }) => requestPasswordReset(await readJson(req), ip));
