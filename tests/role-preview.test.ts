import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { User, type UserDoc } from "@/models";
import { loadSessionUser, type SessionUser } from "@/lib/auth/actor";
import { PREVIEW_COOKIE, SESSION_COOKIE, signPreview, signSession, verifyPreview, verifySession, type SessionPayload } from "@/lib/auth/token";
import { applyRolePreview, PREVIEW_ORGANIZATION_ID } from "@/lib/auth/preview";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { teamNavigation } from "@/lib/permissions/navigation";
import { makeTenants } from "./helpers";

/**
 * "View as Role": the Owner previews any role without changing their session or identity.
 * The preview is resolved centrally (getSessionUser), is read-only in the API layer, and the
 * proxy routes by the previewed role. Isolated test fixtures only.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null, payload: null as SessionPayload | null, previewCookie: null as unknown, cleared: 0 }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => session.current,
  getSessionPayload: async () => session.payload,
  getActor: async () => session.current?.actor ?? null,
  setPreviewCookie: async (p: unknown) => {
    session.previewCookie = p;
  },
  clearPreviewCookie: async () => {
    session.cleared++;
  },
  clearSessionCookie: async () => {
    session.cleared++;
  },
}));

const previewRoute = await import("@/app/api/role-preview/route");
const { GET: clientsRoute } = await import("@/app/api/clients/route");
const { GET: companiesRoute } = await import("@/app/api/companies/route");
const { GET: conversationsRoute } = await import("@/app/api/conversations/route");
const { POST: markAllReadRoute } = await import("@/app/api/notifications/route");
const { POST: logoutRoute } = await import("@/app/api/auth/logout/route");
const { setRoleTemplate } = await import("@/features/access/service");
const { proxy } = await import("@/proxy");

let t: Awaited<ReturnType<typeof makeTenants>>;
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = () => ({ params: Promise.resolve({}) });
const post = (url: string, body: unknown, method = "POST") => req(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function signIn(id: unknown, previewRole?: Role) {
  const u = await User.findById(id).lean<UserDoc>();
  const payload: SessionPayload = { sub: String(u!._id), role: u!.role as Role, sv: u!.sessionVersion ?? 0, mf: true };
  session.payload = payload;
  const user = await loadSessionUser(payload);
  session.current = await applyRolePreview(user, payload, previewRole ? { sub: payload.sub, sv: payload.sv, role: previewRole } : null);
  return session.current!;
}

beforeAll(async () => {
  t = await makeTenants();
});

describe("Central preview resolution", () => {
  it("keeps the Owner's identity and applies the role template's current permissions", async () => {
    const user = await signIn(t.owner.user._id, "STAFF");
    expect(user.id).toBe(String(t.owner.user._id));
    expect(user.email).toBe(t.owner.user.email);
    expect(user.role).toBe("STAFF");
    expect(user.actor.role).toBe("STAFF");
    expect(user.preview).toEqual({ role: "STAFF", label: ROLE_LABELS.STAFF, realRole: "OWNER" });
    expect(user.actor.permissions).not.toContain("users.manage");
    // The navigation is built by the same rules as for a real Staff account.
    const hrefs = teamNavigation(user.actor).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/staff/tickets");
    expect(hrefs).not.toContain("/staff/users");
    // The stored account is untouched.
    const stored = await User.findById(t.owner.user._id).lean<UserDoc>();
    expect(stored!.role).toBe("OWNER");
  });

  it("reflects role-template changes on the very next request", async () => {
    await signIn(t.owner.user._id);
    await setRoleTemplate(session.current!.actor, { role: "MANAGER", permissions: ["analytics.view", "companies.read"] });
    let user = await signIn(t.owner.user._id, "MANAGER");
    expect([...user.actor.permissions].sort()).toEqual(["analytics.view", "companies.read"]);
    await signIn(t.owner.user._id);
    await setRoleTemplate(session.current!.actor, { role: "MANAGER", permissions: ["analytics.view"] });
    user = await signIn(t.owner.user._id, "MANAGER");
    expect(user.actor.permissions).toEqual(["analytics.view"]);
  });

  it("never applies to anyone but the Owner the token was issued to", async () => {
    const admin = await signIn(t.admin.user._id, "STAFF");
    expect(admin.role).toBe("ADMIN");
    expect(admin.preview).toBeUndefined();
    const owner = await loadSessionUser({ sub: String(t.owner.user._id), role: "OWNER", sv: 0 });
    const payload = { sub: String(t.owner.user._id), role: "OWNER" as Role, sv: 0 };
    expect((await applyRolePreview(owner, payload, { sub: String(new Types.ObjectId()), sv: 0, role: "STAFF" }))!.role).toBe("OWNER");
    // A token from an earlier session (sessions revoked → version bumped) is ignored.
    expect((await applyRolePreview(owner, payload, { sub: payload.sub, sv: 7, role: "STAFF" }))!.role).toBe("OWNER");
  });

  it("gives a Client preview an organization that matches no data", async () => {
    const user = await signIn(t.owner.user._id, "CLIENT");
    expect(user.actor.organizationId).toBe(PREVIEW_ORGANIZATION_ID);
    expect(user.actor.permissions).toEqual([]);
    const res = await conversationsRoute(req("/api/conversations"), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown[] };
    expect(body.items ?? []).toHaveLength(0);
  });

  it("rejects invalid, Owner and session tokens as preview tokens (and vice versa)", async () => {
    const sub = String(t.owner.user._id);
    expect(await verifyPreview(await signPreview({ sub, sv: 0, role: "OWNER" }))).toBeNull();
    expect(await verifyPreview(await signPreview({ sub, sv: 0, role: "NOT_A_ROLE" as Role }))).toBeNull();
    expect(await verifyPreview(await signSession({ sub, role: "STAFF", sv: 0 }))).toBeNull();
    expect(await verifyPreview("garbage")).toBeNull();
    expect(await verifySession(await signPreview({ sub, sv: 0, role: "STAFF" }))).toBeNull();
    expect(await verifyPreview(await signPreview({ sub, sv: 0, role: "STAFF" }))).toEqual({ sub, sv: 0, role: "STAFF" });
  });
});

describe("Role preview API", () => {
  it("lists every role from the catalog except the Owner, with current permissions", async () => {
    await signIn(t.owner.user._id);
    const res = await previewRoute.GET(req("/api/role-preview"), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: unknown; roles: { role: string; permissions: unknown[] }[] };
    expect(body.active).toBeNull();
    expect(body.roles.map((r) => r.role)).toEqual(ROLES.filter((r) => r !== "OWNER"));
  });

  it("is Owner only — also while the Owner is previewing", async () => {
    for (const id of [t.admin.user._id, t.staff.user._id, t.clientA.user._id]) {
      await signIn(id);
      expect((await previewRoute.GET(req("/api/role-preview"), ctx())).status).toBe(403);
      expect((await previewRoute.POST(post("/api/role-preview", { role: "STAFF" }), ctx())).status).toBe(403);
    }
    await signIn(t.owner.user._id, "STAFF");
    const res = await previewRoute.GET(req("/api/role-preview"), ctx());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { active: { role: string } }).active.role).toBe("STAFF");
  });

  it("starts, switches and ends a preview without touching the session", async () => {
    await signIn(t.owner.user._id);
    const before = await User.findById(t.owner.user._id).lean<UserDoc>();
    let res = await previewRoute.POST(post("/api/role-preview", { role: "DIGITAL_MARKETER" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "DIGITAL_MARKETER", home: "/staff" });
    expect(session.previewCookie).toEqual({ sub: String(t.owner.user._id), sv: before!.sessionVersion ?? 0, role: "DIGITAL_MARKETER" });
    await signIn(t.owner.user._id, "DIGITAL_MARKETER");
    res = await previewRoute.POST(post("/api/role-preview", { role: "CLIENT" }), ctx());
    expect(await res.json()).toMatchObject({ role: "CLIENT", home: "/portal" });
    expect((await previewRoute.POST(post("/api/role-preview", { role: "OWNER" }), ctx())).status).toBe(400);
    expect((await previewRoute.POST(post("/api/role-preview", { role: "GHOST" }), ctx())).status).toBe(400);
    const cleared = session.cleared;
    res = await previewRoute.DELETE(req("/api/role-preview", { method: "DELETE" }), ctx());
    expect(await res.json()).toMatchObject({ ok: true, home: "/dashboard" });
    expect(session.cleared).toBe(cleared + 1);
    const after = await User.findById(t.owner.user._id).lean<UserDoc>();
    expect(after!.role).toBe("OWNER");
    expect(after!.sessionVersion ?? 0).toBe(before!.sessionVersion ?? 0);
  });
});

describe("Backend authorization during a preview", () => {
  it("applies the previewed role's access — Owner-only APIs are closed", async () => {
    await signIn(t.owner.user._id, "ADMIN");
    expect((await clientsRoute(req("/api/clients"), ctx())).status).toBe(200);
    expect((await companiesRoute(req("/api/companies?country=NO"), ctx())).status).toBe(403);
    await signIn(t.owner.user._id, "DIGITAL_MARKETER");
    expect((await clientsRoute(req("/api/clients"), ctx())).status).toBe(403);
    await signIn(t.owner.user._id);
    expect((await companiesRoute(req("/api/companies?country=NO"), ctx())).status).toBe(200);
  });

  it("refuses every state-changing request except session housekeeping", async () => {
    await signIn(t.owner.user._id, "STAFF");
    const res = await markAllReadRoute(post("/api/notifications", {}), ctx());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PREVIEW_READ_ONLY");
    await signIn(t.owner.user._id);
    expect((await markAllReadRoute(post("/api/notifications", {}), ctx())).status).toBe(200);
    // Signing out still works from a preview (and signs the Owner out).
    await signIn(t.owner.user._id, "STAFF");
    const sv = (await User.findById(t.owner.user._id).lean<UserDoc>())!.sessionVersion ?? 0;
    expect((await logoutRoute(post("/api/auth/logout", {}), ctx())).status).toBe(200);
    expect((await User.findById(t.owner.user._id).lean<UserDoc>())!.sessionVersion).toBe(sv + 1);
  });
});

describe("Proxy routing during a preview", () => {
  const sub = String(new Types.ObjectId());
  const cookies = async (role: Role, preview?: { role: Role; sub?: string; sv?: number }) =>
    [`${SESSION_COOKIE}=${await signSession({ sub, role, sv: 0 })}`, preview && `${PREVIEW_COOKIE}=${await signPreview({ sub: preview.sub ?? sub, sv: preview.sv ?? 0, role: preview.role })}`].filter(Boolean).join("; ");
  const go = async (path: string, cookie: string) => proxy(req(path, { headers: { cookie } }));

  it("routes by the previewed role on direct URLs and refreshes", async () => {
    const staff = await cookies("OWNER", { role: "STAFF" });
    expect((await go("/dashboard/today", staff)).headers.get("location")).toMatch(/\/staff$/);
    expect((await go("/dashboard/tickets", staff)).headers.get("location")).toMatch(/\/staff\/tickets$/);
    expect((await go("/dashboard/opportunities", staff)).status).toBe(404);
    expect((await go("/staff/tickets", staff)).headers.get("location")).toBeNull();
    const client = await cookies("OWNER", { role: "CLIENT" });
    expect((await go("/staff", client)).headers.get("location")).toMatch(/\/portal$/);
    expect((await go("/portal/tickets", client)).headers.get("x-middleware-rewrite")).toMatch(/\/portal\/preview$/);
  });

  it("ignores and removes preview cookies that are not the Owner's own", async () => {
    const plain = await cookies("OWNER");
    expect((await go("/dashboard/today", plain)).headers.get("location")).toBeNull();
    const foreign = await cookies("OWNER", { role: "STAFF", sub: String(new Types.ObjectId()) });
    const res = await go("/dashboard/today", foreign);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain(`${PREVIEW_COOKIE}=;`);
    // A non-Owner holding a preview cookie keeps their own access.
    const admin = await cookies("ADMIN", { role: "CLIENT" });
    expect((await go("/staff", admin)).headers.get("location")).toBeNull();
    expect((await go("/portal/preview", await cookies("CLIENT"))).headers.get("location")).toMatch(/\/portal$/);
  });
});
