import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES } from "@/config/languages";
import { PREVIEW_COOKIE, SESSION_COOKIE, verifyPreview, verifySession } from "@/lib/auth/token";

/**
 * Proxy (formerly middleware):
 *  1. Locale routing — English is served at clean URLs ("/services") by an
 *     internal rewrite to "/en/services"; "/en/..." redirects to the clean URL;
 *     "/de/...", "/no/..." etc. pass through.
 *  2. Coarse auth gating per area (signature check only). Real authorization
 *     happens server-side on every page and API call:
 *       /dashboard → OWNER · /staff → ADMIN, STAFF, DIGITAL_MARKETER · /portal → CLIENT
 *  3. "View as Role": while the Owner previews a role (signed preview cookie bound to the Owner's
 *     session), areas are gated by the previewed role, so links, direct URLs and refreshes land
 *     where that role would. A Client preview shows the portal's placeholder page (no client
 *     organization's data). An invalid or expired preview cookie is removed.
 */
const APP_PREFIXES = ["/dashboard", "/staff", "/portal"];
const NON_LOCALIZED = ["/api", "/_next", "/dashboard", "/staff", "/portal", "/favicon", "/icon", "/apple-icon", "/robots.txt", "/sitemap.xml", "/opengraph-image", "/manifest"];
/** Owner-dashboard sections that also exist in the staff workspace (client data, website maintenance). */
const STAFF_SECTIONS = ["inquiries", "profile", "clients", "messages", "tickets", "projects", "services", "notifications", "settings"];

/** Owner-only modules (also enforced by their pages, APIs and services). */
const OWNER_ONLY_SECTIONS = ["/dashboard/opportunities", "/dashboard/website-analytics", "/dashboard/marketer-leads"];
const TEAM_WORKSPACE_ROLES = ["ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"];
const PORTAL_PREVIEW_PAGE = "/portal/preview";

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
    const previewToken = request.cookies.get(PREVIEW_COOKIE)?.value;
    const preview = previewToken && session.role === "OWNER" ? await verifyPreview(previewToken) : null;
    const previewValid = !!preview && preview.sub === session.sub && preview.sv === session.sv;
    const role = previewValid ? preview.role : session.role;
    const res = gateArea(request, role, previewValid);
    if (previewToken && !previewValid) res.cookies.delete(PREVIEW_COOKIE);
    return res;
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

/** Area gating for /dashboard, /staff and /portal by the effective role (the previewed one during a preview). */
function gateArea(request: NextRequest, role: string, previewing: boolean) {
  const { pathname, search } = request.nextUrl;
  const area = pathname.split("/")[1];
  if (area === "dashboard" && role !== "OWNER") {
    // Owner-only modules: other roles get a plain 404 before any rendering.
    if (OWNER_ONLY_SECTIONS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    }
    if (role === "CLIENT") return NextResponse.redirect(new URL("/portal", request.url));
    // ADMIN/STAFF: links to shared sections (e.g. from notifications or emails) open in the staff workspace.
    const section = pathname.split("/")[2] ?? "";
    const target = STAFF_SECTIONS.includes(section) ? `/staff${pathname.slice("/dashboard".length)}${search}` : "/staff";
    return NextResponse.redirect(new URL(target, request.url));
  }
  if (area === "staff" && !TEAM_WORKSPACE_ROLES.includes(role)) {
    // The team workspace's management table is the Owner's /dashboard/marketer-leads.
    if (role === "OWNER" && pathname.startsWith("/staff/marketer-table")) return NextResponse.redirect(new URL(`/dashboard/marketer-leads${search}`, request.url));
    if (role === "OWNER") return NextResponse.redirect(new URL(`/dashboard${pathname.slice("/staff".length)}${search}`, request.url));
    return NextResponse.redirect(new URL(homeFor(role), request.url));
  }
  if (area === "portal" && role !== "CLIENT") return NextResponse.redirect(new URL(homeFor(role), request.url));
  if (area === "portal" && pathname === PORTAL_PREVIEW_PAGE && !previewing) return NextResponse.redirect(new URL("/portal", request.url));
  // Client preview: every portal page shows the placeholder (the URL and navigation stay as they are).
  if (area === "portal" && previewing && pathname !== PORTAL_PREVIEW_PAGE) {
    const url = request.nextUrl.clone();
    url.pathname = PORTAL_PREVIEW_PAGE;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|woff2?)$).*)"],
};
