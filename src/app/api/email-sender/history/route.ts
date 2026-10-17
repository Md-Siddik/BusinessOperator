import { route } from "@/lib/api/handler";
import { listSentEmails } from "@/features/email-sender/service";

/** Email Sender history (OWNER ONLY). Records hold recipient, mode, subject and status — not message bodies. */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => listSentEmails(actor, { page: Number(req.nextUrl.searchParams.get("page")) || 1 }));
