import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { resetPassword } from "@/features/auth/service";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.passwordReset }, async ({ req }) => resetPassword(await readJson(req)));
