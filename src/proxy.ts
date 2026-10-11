import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "@/config/languages";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

/**
 * Proxy (formerly middleware):
 *  1. Locale routing — English is served at clean URLs ("/services") by an
 *     internal rewrite to "/en/services"; "/en/..." redirects to the clean URL;
 *     "/de/...", "/no/..." etc. pass through.
 *  2. Coarse auth gating for /dashboard and /portal (signature check only).
 *     Real authorization happens server-side on every page and API call.
 */
const APP_PREFIXES = ["/dashboard", "/portal"];
const NON_LOCALIZED = ["/api", "/_next", "/dashboard", "/portal", "/favicon", "/icon", "/apple-icon", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/manifest"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/dashboard") && session.role === "CLIENT") return NextResponse.redirect(new URL("/portal", request.url));
    // Owner-only module: other roles get a plain 404 before any rendering (pages and APIs re-check server-side).
    if ((pathname === "/dashboard/opportunities" || pathname.startsWith("/dashboard/opportunities/")) && session.role !== "OWNER") {
      return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    }
    if (pathname.startsWith("/portal") && session.role !== "CLIENT") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  if (NON_LOCALIZED.some((p) => pathname.startsWith(p)) || /\.[a-z0-9]{2,5}$/i.test(pathname)) return NextResponse.next();

  const first = pathname.split("/")[1] ?? "";
  if (first === DEFAULT_LANGUAGE) {
    const clean = pathname.slice(DEFAULT_LANGUAGE.length + 1) || "/";
    return NextResponse.redirect(new URL(`${clean}${search}`, request.url), 308);
  }
  if ((LANGUAGE_CODES as string[]).includes(first)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LANGUAGE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|woff2?)$).*)"],
};
