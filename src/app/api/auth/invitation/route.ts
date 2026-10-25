import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { acceptInvitation } from "@/features/auth/invitations";
export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.signup }, async ({ req }) => acceptInvitation(await readJson(req)));
