import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "@/config/languages";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

/**
 * Proxy (formerly middleware):
 *  1. Locale routing — English is served at clean URLs ("/services") by an
 *     internal rewrite to "/en/services"; "/en/..." redirects to the clean URL;
 *     "/de/...", "/no/..." etc. pass through.
 *  2. Coarse auth gating per area (signature check only). Real authorization
 *     happens server-side on every page and API call:
 *       /dashboard → OWNER · /staff → ADMIN, STAFF, DIGITAL_MARKETER · /portal → CLIENT
 */
const APP_PREFIXES = ["/dashboard", "/staff", "/portal"];
const NON_LOCALIZED = ["/api", "/_next", "/dashboard", "/staff", "/portal", "/favicon", "/icon", "/apple-icon", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/manifest"];
/** Owner-dashboard sections that also exist in the staff workspace (client data, website maintenance). */
const STAFF_SECTIONS = ["inquiries", "profile", "clients", "messages", "tickets", "projects", "services", "notifications", "settings"];

/** Owner-only modules (also enforced by their pages, APIs and services). */
const OWNER_ONLY_SECTIONS = ["/dashboard/opportunities", "/dashboard/website-analytics"];
const TEAM_WORKSPACE_ROLES = ["ADMIN", "STAFF", "DIGITAL_MARKETER"];

function homeFor(role: string) {
  return role === "OWNER" ? "/dashboard" : role === "CLIENT" ? "/portal" : "/staff";
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    const area = pathname.split("/")[1];
    if (area === "dashboard" && session.role !== "OWNER") {
      // Owner-only modules: other roles get a plain 404 before any rendering.
      if (OWNER_ONLY_SECTIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
        return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
      }
      if (session.role === "CLIENT") return NextResponse.redirect(new URL("/portal", request.url));
      // ADMIN/STAFF: links to shared sections (e.g. from notifications or emails) open in the staff workspace.
      const section = pathname.split("/")[2] ?? "";
      const target = STAFF_SECTIONS.includes(section) ? `/staff${pathname.slice("/dashboard".length)}${search}` : "/staff";
      return NextResponse.redirect(new URL(target, request.url));
    }
    if (area === "staff" && !TEAM_WORKSPACE_ROLES.includes(session.role)) {
      if (session.role === "OWNER") return NextResponse.redirect(new URL(`/dashboard${pathname.slice("/staff".length)}${search}`, request.url));
      return NextResponse.redirect(new URL(homeFor(session.role), request.url));
    }
    if (area === "portal" && session.role !== "CLIENT") return NextResponse.redirect(new URL(homeFor(session.role), request.url));
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
