import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { signupClient } from "@/features/auth/service";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.signup }, async ({ req, ip }) => signupClient(await readJson(req), ip));
