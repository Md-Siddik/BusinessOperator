import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { connectToDatabase, DatabaseUnavailableError } from "@/lib/db/connect";
import { AppError, Errors } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth/session";
import { isActiveSessionUser } from "@/lib/auth/actor";
import { can, isInternal, isOwner, type Actor, type Permission } from "@/lib/permissions";
import { enforceRateLimit, type RateLimitRule } from "@/lib/rate-limit";

type Options = {
  auth?: "required" | "optional" | "none";
  /** Restrict to OWNER/ADMIN/STAFF. */
  internal?: boolean;
  /** Restrict to the OWNER role (role checked on the server; not a delegable permission). */
  ownerOnly?: boolean;
  /** Restrict to CLIENT users. */
  clientOnly?: boolean;
  permission?: Permission;
  rateLimit?: RateLimitRule;
};

export type RouteContext<P> = { req: NextRequest; actor: Actor | null; params: P; ip: string };
export type AuthedContext<P> = RouteContext<P> & { actor: Actor };

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
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
      if (options.rateLimit) enforceRateLimit(options.rateLimit, ip);
      await connectToDatabase();

      let actor: Actor | null = null;
      if (auth !== "none") {
        const user = await getSessionUser();
        actor = user && isActiveSessionUser(user) ? user.actor : null;
      }
      if (auth === "required" && !actor) throw Errors.unauthorized();
      if (options.internal && !isInternal(actor)) throw Errors.forbidden();
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
