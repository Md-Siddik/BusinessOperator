import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ContactRequest } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { makeTenants } from "./helpers";
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.current }));
const list = await import("@/app/api/inquiries/route");
const detail = await import("@/app/api/inquiries/[id]/route");
const users = await import("@/app/api/admin/users/route");
let t: Awaited<ReturnType<typeof makeTenants>>;
let id: string;
function as(user: { actor: SessionUser["actor"] } | null, verified = true) {
  session.current = user ? { ...user.actor, status: "ACTIVE", organizationStatus: "ACTIVE", emailVerifiedAt: verified ? new Date() : undefined, actor: user.actor } : null;
}
const req = (path: string, method = "GET", body?: unknown) => new NextRequest(new URL(path, "http://localhost:3000"), { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
const ctx = () => ({ params: Promise.resolve({ id }) });
beforeAll(async () => {
  t = await makeTenants();
  const inquiry = await ContactRequest.create({ name: "API client", email: t.clientA.actor.email, userId: t.clientA.actor.id, emailVerifiedAt: new Date(), message: "Private inquiry details." });
  id = String(inquiry._id);
});
describe("Inquiry API access boundaries", () => {
  it("requires an active verified session, including on direct API requests", async () => {
    as(null);
    expect((await list.GET(req("/api/inquiries"), ctx())).status).toBe(401);
    as(t.clientA, false);
    expect((await detail.GET(req("/api/inquiries/" + id), ctx())).status).toBe(401);
  });
  it("returns only the requesting client's records and prevents guessed IDs", async () => {
    as(t.clientA);
    expect((await detail.GET(req("/api/inquiries/" + id), ctx())).status).toBe(200);
    as(t.clientB);
    expect((await detail.GET(req("/api/inquiries/" + id), ctx())).status).toBe(404);
    const response = await list.GET(req("/api/inquiries"), ctx());
    expect((await response.json()).items).toEqual([]);
    expect((await detail.PATCH(req("/api/inquiries/" + id, "PATCH", { status: "ACCEPTED" }), ctx())).status).toBe(403);
  });
  it("allows Owner/Super Admin and rejects clients from user-management APIs", async () => {
    for (const user of [t.owner, t.admin]) {
      as(user);
      expect((await detail.GET(req("/api/inquiries/" + id), ctx())).status).toBe(200);
      expect((await users.GET(req("/api/admin/users"), ctx())).status).toBe(200);
    }
    as(t.staff);
    expect((await detail.GET(req("/api/inquiries/" + id), ctx())).status).toBe(403);
    as(t.clientA);
    expect((await users.GET(req("/api/admin/users"), ctx())).status).toBe(403);
  });
  it("blocks cross-site state-changing inquiry requests", async () => {
    as(t.owner);
    const request = new NextRequest("http://localhost:3000/api/inquiries/" + id, { method: "PATCH", headers: { origin: "https://attacker.example", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ status: "REJECTED" }) });
    expect((await detail.PATCH(request, ctx())).status).toBe(403);
  });
});
