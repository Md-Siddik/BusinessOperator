import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Company } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { GET as exportRoute } from "@/app/api/companies/export/route";
import { GET as researchStatusRoute } from "@/app/api/research/status/route";
import { GET as inboxRoute } from "@/app/api/inbox/route";
import { GET as quotationsRoute } from "@/app/api/quotations/route";
import type { SessionUser } from "@/lib/auth/actor";
import { makeTenants } from "./helpers";

/**
 * API authorization tests: the real route handlers, with only the session
 * lookup mocked (there is no browser cookie jar in unit tests).
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { GET: listCompaniesRoute } = await import("@/app/api/companies/route");
const { GET: listConversationsRoute } = await import("@/app/api/conversations/route");
const { POST: suppressionRoute } = await import("@/app/api/outreach/suppression/route");

let t: Awaited<ReturnType<typeof makeTenants>>;

function as(user: { actor: SessionUser["actor"] } | null, status = "ACTIVE") {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status, organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", actor: user.actor } : null;
}
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = { params: Promise.resolve({}) };

beforeAll(async () => {
  t = await makeTenants();
  const osloToday = todayIn("Europe/Oslo");
  await Company.create([
    { companyName: "Nordic AS", countryCode: "NO", source: "t", sourceId: "1", registrationDay: osloToday, email: "post@nordic.example" },
    { companyName: "Nordic Yesterday AS", countryCode: "NO", source: "t", sourceId: "3", registrationDay: addDays(osloToday, -1) },
    { companyName: "Svensk AB", countryCode: "SE", source: "t", sourceId: "2", registrationDay: todayIn("Europe/Stockholm") },
  ]);
});

describe("API authorization", () => {
  it("requires authentication", async () => {
    as(null);
    expect((await listCompaniesRoute(req("/api/companies?country=NO"), ctx)).status).toBe(401);
  });

  it("forbids clients from company intelligence", async () => {
    as(t.clientA);
    expect((await listCompaniesRoute(req("/api/companies?country=NO"), ctx)).status).toBe(403);
  });

  it("pending accounts are treated as unauthenticated", async () => {
    as(t.staff, "PENDING_APPROVAL");
    expect((await listCompaniesRoute(req("/api/companies?country=NO"), ctx)).status).toBe(401);
  });

  it("GET /api/companies?country=NO defaults to today and only returns Norway (database-side)", async () => {
    as(t.staff);
    const res = await listCompaniesRoute(req("/api/companies?country=NO"), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { countryCode: string; companyName: string; email?: string }[] };
    expect(body.items.map((c) => c.companyName)).toEqual(["Nordic AS"]);
    expect(body.items[0]!.email).toBe("post@nordic.example");
    const week = (await (await listCompaniesRoute(req("/api/companies?country=NO&range=7d"), ctx)).json()) as { items: { countryCode: string }[] };
    expect(week.items).toHaveLength(2);
    expect(week.items.every((c) => c.countryCode === "NO")).toBe(true);
  });

  it("export requires companies.export and neutralizes nothing it shouldn't", async () => {
    as(t.staff);
    expect((await exportRoute(req("/api/companies/export?country=NO"), ctx)).status).toBe(403);
    as(t.owner);
    const res = await exportRoute(req("/api/companies/export?country=NO"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain('"Nordic AS"');
    expect(csv).toContain('"post@nordic.example"');
    expect(csv).not.toContain("Svensk AB");
  });

  it("validates input and returns structured errors without stack traces", async () => {
    as(t.staff);
    const res = await listCompaniesRoute(req("/api/companies?country=ZZ"), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string; stack?: unknown } };
    expect(body.error.message).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("research, inbox and quotations are internal-only", async () => {
    as(t.clientA);
    expect((await researchStatusRoute(req("/api/research/status"), ctx)).status).toBe(403);
    expect((await inboxRoute(req("/api/inbox"), ctx)).status).toBe(403);
    expect((await quotationsRoute(req("/api/quotations"), ctx)).status).toBe(403);
    as(t.staff);
    expect((await inboxRoute(req("/api/inbox"), ctx)).status).toBe(200);
  });

  it("blocks cross-site state-changing requests", async () => {
    as(t.owner);
    const res = await suppressionRoute(req("/api/outreach/suppression", { method: "POST", body: JSON.stringify({ email: "x@y.example" }), headers: { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" } }), ctx);
    expect(res.status).toBe(403);
  });

  it("clients only see their own conversations through the API", async () => {
    as(t.clientA);
    const res = await listConversationsRoute(req("/api/conversations"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
