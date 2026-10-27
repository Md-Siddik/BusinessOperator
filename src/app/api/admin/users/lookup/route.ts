import { route } from "@/lib/api/handler";
import { lookupEmployeeCandidate } from "@/features/users/service";

/** Owner / Super Admin: what adding this email as an employee would do (new, activate existing, duplicate, blocked). */
export const GET = route({ internal: true, staff: true, permission: "users.manage" }, async ({ req, actor }) => lookupEmployeeCandidate(actor, req.nextUrl.searchParams.get("email") ?? ""));
