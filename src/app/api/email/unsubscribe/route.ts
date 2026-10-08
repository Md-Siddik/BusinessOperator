import { NextResponse } from "next/server";
import { route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { addSuppression } from "@/features/outreach/suppression";

/** RFC 8058 one-click unsubscribe (POST) — adds the address to the suppression list. */
export const POST = route({ auth: "none" }, async ({ req }) => {
  const email = verifyUnsubscribeToken(req.nextUrl.searchParams.get("token"));
  if (!email) throw Errors.badRequest("Invalid unsubscribe link");
  await addSuppression(null, { email, reason: "OPT_OUT" }, "unsubscribe-link");
  return { ok: true };
});

/** GET never mutates (link scanners) — it forwards to the confirmation page. */
export const GET = route({ auth: "none" }, async ({ req }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  return NextResponse.redirect(new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, req.url));
});
