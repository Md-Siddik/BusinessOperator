import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { submitContactRequest } from "@/features/content/service";

export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.contact }, async ({ req }) => submitContactRequest(await readJson(req)));
