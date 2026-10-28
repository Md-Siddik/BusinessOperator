import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { connectToDatabase, DatabaseUnavailableError } from "@/lib/db/connect";
import { AppError, Errors } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth/session";
import { isActiveSessionUser, isPendingClientUser } from "@/lib/auth/actor";
import { can, canAny, isInternal, isOwner, isStaffMember, isTeamMember, type Actor, type Permission } from "@/lib/permissions";
import { enforceDurableAuthLimit } from "@/lib/auth/rate-limit";
import { audit } from "@/lib/audit";
import { enforceRateLimit, type RateLimitRule } from "@/lib/rate-limit";

type Options = {
  auth?: "required" | "optional" | "none";
  /**
   * Internal API of the owner dashboard → OWNER only. ADMIN/STAFF never reach these
   * (they use the staff workspace); combine with `staff` to open a route to them too.
   */
  internal?: boolean;
  /** Also allow ADMIN/STAFF (staff workspace: client data and website maintenance). */
  staff?: boolean;
  /**
   * Any employee account (Owner, Super Admin, Staff, Digital Marketer). Combine with
   * `permission` / `anyPermission` — a team member holds only what was granted.
   */
  team?: boolean;
  /** At least one of these permissions (the Owner holds all). */
  anyPermission?: Permission[];
  /** Restrict to the OWNER role (role checked on the server; not a delegable permission). */
  ownerOnly?: boolean;
  /** Restrict to CLIENT users. */
  clientOnly?: boolean;
  /**
   * Let a signed-up client whose account is still awaiting approval use this route
   * (live chat only). Their organization must be pending — never suspended.
   */
  allowPendingClient?: boolean;
  permission?: Permission;
  rateLimit?: RateLimitRule;
  /**
   * Allow a state-changing request while the Owner previews another role ("View as Role").
   * Only for session housekeeping (sign out, refresh, starting / ending the preview) — every
   * other POST / PUT / PATCH / DELETE is refused during a preview.
   */
  allowInPreview?: boolean;
};

export type RouteContext<P> = { req: NextRequest; actor: Actor | null; params: P; ip: string };
export type AuthedContext<P> = RouteContext<P> & { actor: Actor };

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

const READ_ONLY_METHODS = ["GET", "HEAD", "OPTIONS"];

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (READ_ONLY_METHODS.includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Errors.forbidden("Invalid origin");
  }
  if (originHost !== host) throw Errors.forbidden("Cross-site request blocked");
}

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Please check the highlighted fields.", fieldErrors: z.flattenError(err).fieldErrors } },
      { status: 400 },
    );
  }
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, ...err.details } }, { status: err.status });
  }
  if (err instanceof DatabaseUnavailableError) {
    return NextResponse.json({ error: { code: "UNAVAILABLE", message: "Service temporarily unavailable." } }, { status: 503 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/**
 * Wrap a route handler with DB connection, authentication, authorization,
 * rate limiting, origin checks and safe error mapping. Never leaks stack traces.
 * Handlers return plain data (serialised as JSON) or a Response.
 */
export function route<P = Record<string, string>>(
  options: Options & { auth: "optional" | "none" },
  handler: (ctx: RouteContext<P>) => Promise<unknown>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function route<P = Record<string, string>>(
  options: Options,
  handler: (ctx: AuthedContext<P>) => Promise<unknown>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function route<P>(options: Options, handler: (ctx: AuthedContext<P>) => Promise<unknown>) {
  const auth = options.auth ?? "required";
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const ip = clientIp(req);
      const durable = options.rateLimit && ["login", "signup", "password-reset", "contact"].includes(options.rateLimit.bucket);
      if (options.rateLimit && !durable) enforceRateLimit(options.rateLimit, ip);
      await connectToDatabase();
      if (options.rateLimit && durable) await enforceDurableAuthLimit(options.rateLimit, ip);

      let actor: Actor | null = null;
      if (auth !== "none") {
        const user = await getSessionUser();
        actor = user && (isActiveSessionUser(user) || (options.allowPendingClient && isPendingClientUser(user))) ? user.actor : null;
        // Role preview is read-only: nothing is created, changed or deleted while previewing.
        if (user?.preview && !READ_ONLY_METHODS.includes(req.method) && !options.allowInPreview) {
          await audit({ id: user.id, email: user.email, role: user.preview.realRole }, "role_preview.write_blocked", { metadata: { previewRole: user.preview.role, method: req.method, path: req.nextUrl.pathname } });
          throw Errors.previewReadOnly();
        }
      }
      if (auth === "required" && !actor) throw Errors.unauthorized();
      if (options.internal && !(isOwner(actor) || (options.staff && isStaffMember(actor)))) throw Errors.forbidden();
      if (options.staff && !options.internal && !isInternal(actor)) throw Errors.forbidden();
      if (options.team && !isTeamMember(actor)) throw Errors.forbidden();
      if (options.anyPermission && !canAny(actor, options.anyPermission)) throw Errors.forbidden();
      if (options.ownerOnly && !isOwner(actor)) throw Errors.forbidden();
      if (options.clientOnly && actor?.role !== "CLIENT") throw Errors.forbidden();
      if (options.permission && !can(actor, options.permission)) throw Errors.forbidden();

      const params = ctx?.params ? await ctx.params : ({} as P);
      const result = await handler({ req, actor: actor as Actor, params, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw Errors.badRequest("Invalid JSON body");
  }
}

export function searchParamsObject(req: NextRequest) {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}
