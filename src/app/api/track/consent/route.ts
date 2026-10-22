import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { VISITOR_COOKIE } from "@/features/website-analytics/classify";
import { forgetVisitor } from "@/features/website-analytics/collect";

/**
 * The visitor declined or withdrew analytics consent: delete what was recorded for this
 * browser and remove the visitor cookie. (Accepting needs no server call — the browser sets
 * et_consent itself and the next beacon is recorded with consent.)
 */
export const POST = route({ auth: "none", rateLimit: RATE_LIMITS.track }, async ({ req }) => {
  const { granted } = z.object({ granted: z.boolean() }).parse(await readJson(req));
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  if (!granted) {
    const vid = req.cookies.get(VISITOR_COOKIE)?.value;
    await forgetVisitor(vid).catch((err) => console.error("[track] failed to forget visitor", err));
    if (vid) res.cookies.delete(VISITOR_COOKIE);
  }
  return res;
});
