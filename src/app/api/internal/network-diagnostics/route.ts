import "server-only";
import crypto from "node:crypto";
import { isIP } from "node:net";
import mongoose from "mongoose";
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/api/handler";
import { connectToDatabase } from "@/lib/db/connect";
import { safeFailure } from "@/lib/diagnostics";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Temporary operator diagnostic: which public IP does this function egress from, and can it
 * reach MongoDB? Disabled (404) unless NETWORK_DIAGNOSTICS_TOKEN (32+ chars) is set.
 *
 *   curl -H "Authorization: Bearer $NETWORK_DIAGNOSTICS_TOKEN" https://<host>/api/internal/network-diagnostics
 *
 * Token auth (not the session) on purpose: session checks need the database, and this must
 * work while the database is unreachable. Returns no credentials, URIs, hostnames, cookies,
 * headers or environment values. The observed IP is one sample of a dynamic address.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IP_LOOKUP_URL = "https://api.ipify.org?format=json";
const IP_LOOKUP_TIMEOUT_MS = 5_000;
const RULE = { bucket: "network-diagnostics", limit: 10, windowMs: 10 * 60_000 };
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function authorized(req: NextRequest) {
  const secret = process.env.NETWORK_DIAGNOSTICS_TOKEN;
  if (!secret || secret.length < 32) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided) return false;
  // Equal-length digests: constant-time comparison without leaking the token length.
  const digest = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(digest(provided), digest(secret));
}

async function observeOutboundIp() {
  try {
    const res = await fetch(IP_LOOKUP_URL, { cache: "no-store", signal: AbortSignal.timeout(IP_LOOKUP_TIMEOUT_MS) });
    if (!res.ok) return { address: null, version: null, error: "lookup_http_error" };
    const { ip } = (await res.json()) as { ip?: unknown };
    const version = typeof ip === "string" ? isIP(ip) : 0;
    return version ? { address: ip as string, version: `IPv${version}`, error: null } : { address: null, version: null, error: "lookup_invalid_response" };
  } catch {
    return { address: null, version: null, error: "lookup_failed" };
  }
}

async function checkDatabase() {
  const started = Date.now();
  let stage = "connect";
  try {
    await connectToDatabase();
    stage = "ping";
    await mongoose.connection.db!.admin().ping();
    return { reachable: true, stage, durationMs: Date.now() - started };
  } catch (err) {
    const { category, errorType, errorCode, causeCode } = safeFailure(err);
    return {
      reachable: false, stage, durationMs: Date.now() - started,
      category: stage === "connect" && category === "operation_failed" ? "database_connect" : category,
      errorType, errorCode, causeCode,
    };
  }
}

export async function GET(req: NextRequest) {
  // Hidden unless enabled and authorized; same response for both so the route is not discoverable.
  if (!checkRateLimit(RULE, clientIp(req)) || !authorized(req)) {
    return new NextResponse("Not found", { status: 404, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const [outboundIp, database] = await Promise.all([observeOutboundIp(), checkDatabase()]);
  return NextResponse.json({
    status: outboundIp.address && database.reachable ? "ok" : "degraded",
    observedAt: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    region: process.env.VERCEL_REGION ?? null,
    outboundIp: { ...outboundIp, source: "api.ipify.org" },
    database,
    note: "One observation of a dynamic address. Vercel Hobby functions do not have a static outbound IP; it can change between invocations, instances, regions and deployments. Do not treat it as a permanent Atlas allowlist entry.",
  }, { headers: HEADERS });
}
