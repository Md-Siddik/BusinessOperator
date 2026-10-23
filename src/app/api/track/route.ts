import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { CONSENT_COOKIE, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "@/features/website-analytics/classify";
import { recordEvent } from "@/features/website-analytics/collect";
import { lookupGeo } from "@/features/website-analytics/geo";

/**
 * Public analytics beacon. Always answers 200: analytics must never affect the website, so
 * failures are logged and swallowed. The response holds nothing about other visitors.
 *
 * The anonymous visitor cookie is only ever set when the browser has accepted analytics
 * (et_consent=granted), and is cleared again when it has not.
 */
export const POST = route({ auth: "optional", rateLimit: RATE_LIMITS.track }, async ({ req, actor, ip }) => {
  const consent = req.cookies.get(CONSENT_COOKIE)?.value === "granted";
  const vid = req.cookies.get(VISITOR_COOKIE)?.value;
  let body: Record<string, unknown> = { ok: true };
  let newVid: string | undefined;
  try {
    const result = await recordEvent(await readJson(req), {
      userAgent: req.headers.get("user-agent"),
      host: req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "",
      consent,
      vid,
      actor,
      // Country/region/city only; the IP is used in memory for the lookup and never stored.
      resolveGeo: () => lookupGeo(req.headers, ip),
    });
    newVid = result.newVid;
    if (result.id) body = { ok: true, id: result.id };
  } catch (err) {
    console.error("[track] failed to record event", err);
    body = { ok: false };
  }
  const res = NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  if (consent && newVid) {
    res.cookies.set(VISITOR_COOKIE, newVid, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: VISITOR_COOKIE_MAX_AGE });
  } else if (!consent && vid) {
    res.cookies.delete(VISITOR_COOKIE);
  }
  return res;
});
