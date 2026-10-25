import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { Conversation, Organization, User, type UserDoc } from "@/models";
import { loadSessionUser, type SessionUser } from "@/lib/auth/actor";
import { signSession, SESSION_COOKIE } from "@/lib/auth/token";
import { signupClient } from "@/features/auth/service";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Owner dashboard / staff workspace / client portal separation, and the live chat that
 * signed-up clients (even those awaiting approval) can use. Isolated test fixtures only.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const { GET: clientsRoute } = await import("@/app/api/clients/route");
const { GET: companiesRoute } = await import("@/app/api/companies/route");
const { GET: settingsRoute } = await import("@/app/api/admin/settings/[key]/route");
const { GET: listConvRoute, POST: startConvRoute } = await import("@/app/api/conversations/route");
const { POST: sendRoute } = await import("@/app/api/conversations/[id]/messages/route");
const { GET: unreadRoute } = await import("@/app/api/messages/unread/route");
const { GET: ticketsRoute } = await import("@/app/api/tickets/route");
const { GET: chatSessionRoute } = await import("@/app/api/chat/session/route");
const { GET: opportunitiesRoute } = await import("@/app/api/opportunities/route");
const { GET: authStatusRoute } = await import("@/app/api/auth/status/route");
const { getClientSummary } = await import("@/features/clients/summary");
const { proxy } = await import("@/proxy");

let t: Awaited<ReturnType<typeof makeTenants>>;
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });

async function asUser(id: unknown) {
  const u = await User.findById(id).lean<UserDoc>();
  session.current = await loadSessionUser({ sub: String(u!._id), role: u!.role as never, sv: u!.sessionVersion ?? 0, mf: true });
}
function asActor(user: { actor: SessionUser["actor"] } | null) {
  session.current = user ? { id: user.actor.id, name: user.actor.name, email: user.actor.email, role: user.actor.role, status: "ACTIVE", organizationId: user.actor.organizationId, organizationStatus: "ACTIVE", emailVerifiedAt: new Date(), actor: user.actor } : null;
}

beforeAll(async () => {
  t = await makeTenants();
});

describe("Staff workspace API (ADMIN / STAFF)", () => {
  it("may use client-data routes but never owner-dashboard APIs", async () => {
    asActor(t.admin);
    expect((await clientsRoute(req("/api/clients"), ctx())).status).toBe(200);
    expect((await companiesRoute(req("/api/companies?country=NO"), ctx())).status).toBe(403);
    expect((await opportunitiesRoute(req("/api/opportunities"), ctx())).status).toBe(403);
    asActor(t.staff);
    expect((await companiesRoute(req("/api/companies?country=NO"), ctx())).status).toBe(403);
    expect((await ticketsRoute(req("/api/tickets"), ctx())).status).toBe(200);
  });

  it("may read website settings, not owner configuration", async () => {
    asActor(t.staff);
    expect((await settingsRoute(req("/api/admin/settings/general"), ctx({ key: "general" }))).status).toBe(200);
    expect((await settingsRoute(req("/api/admin/settings/outreach"), ctx({ key: "outreach" }))).status).toBe(403);
    expect((await settingsRoute(req("/api/admin/settings/leadScoring"), ctx({ key: "leadScoring" }))).status).toBe(403);
    asActor(t.owner);
    expect((await settingsRoute(req("/api/admin/settings/outreach"), ctx({ key: "outreach" }))).status).toBe(200);
  });

  it("clients never reach staff routes", async () => {
    asActor(t.clientA);
    expect((await clientsRoute(req("/api/clients"), ctx())).status).toBe(403);
  });

  it("client summary counts stored records and respects permissions", async () => {
    const before = await getClientSummary(t.owner.actor);
    await Organization.create({ name: "Summary Pending Co", slug: `summary-pending-${Date.now()}`, status: "PENDING_APPROVAL" });
    const after = await getClientSummary(t.owner.actor);
    expect(after.counts.pendingClients! - before.counts.pendingClients!).toBe(1);
    expect(after.recentClients[0]!.name).toBe("Summary Pending Co");
    // STAFF has no clients.manage by default: no client list or client counts.
    const staffView = await getClientSummary(t.staff.actor);
    expect(staffView.canSeeClients).toBe(false);
    expect(staffView.counts.activeClients).toBeNull();
    expect(staffView.recentClients).toHaveLength(0);
    await expectRejects(getClientSummary(t.clientA.actor), 403);
  });
});

describe("Live chat: signup is required; pending clients can chat but nothing else", () => {
  let pendingUserId: unknown;
  beforeAll(async () => {
    await signupClient({ name: "Pending Person", company: "Pending Chat AS", email: "pending-chat@example.test", password: "a-strong-password-123", country: "NO" });
    await User.updateOne({ email: "pending-chat@example.test" }, { $set: { emailVerifiedAt: new Date() } });
    pendingUserId = (await User.findOne({ email: "pending-chat@example.test" }).lean<UserDoc>())!._id;
  });

  it("anonymous visitors are asked to sign up; they cannot open or post to conversations", async () => {
    session.current = null;
    const s = (await (await chatSessionRoute(req("/api/chat/session"), ctx())).json()) as { state: string };
    expect(s.state).toBe("anonymous");
    expect((await listConvRoute(req("/api/conversations"), ctx())).status).toBe(401);
  });

  it("a client awaiting approval can start a chat and send messages in their own organization", async () => {
    await asUser(pendingUserId);
    expect(session.current?.status).toBe("PENDING_APPROVAL");
    const s = (await (await chatSessionRoute(req("/api/chat/session"), ctx())).json()) as { state: string; pending: boolean };
    expect(s).toMatchObject({ state: "client", pending: true });

    const form = new FormData();
    form.set("subject", "Website chat");
    form.set("topic", "GENERAL");
    form.set("body", "Hello, I just signed up");
    const started = await startConvRoute(req("/api/conversations", { method: "POST", body: form }), ctx());
    expect(started.status).toBe(200);
    const { conversationId } = (await started.json()) as { conversationId: string };
    const conv = await Conversation.findById(conversationId).lean<{ organizationId: Types.ObjectId }>();
    expect(String(conv!.organizationId)).toBe(session.current!.organizationId);

    const sent = await sendRoute(req(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ body: "Second message" }), headers: { "content-type": "application/json" } }), ctx({ id: conversationId }));
    expect(sent.status).toBe(200);
    expect((await unreadRoute(req("/api/messages/unread"), ctx())).status).toBe(200);
    const list = (await (await listConvRoute(req("/api/conversations"), ctx())).json()) as { _id: string }[];
    expect(list.map((c) => c._id)).toEqual([conversationId]);
  });

  it("…but every other area still requires approval", async () => {
    await asUser(pendingUserId);
    expect((await ticketsRoute(req("/api/tickets"), ctx())).status).toBe(401);
    expect((await clientsRoute(req("/api/clients"), ctx())).status).toBe(401);
  });

  it("a suspended organization's users cannot chat", async () => {
    const org = await Organization.findOne({ name: "Pending Chat AS" });
    await Organization.updateOne({ _id: org!._id }, { $set: { status: "SUSPENDED" } });
    expect(await loadSessionUser({ sub: String(pendingUserId), role: "CLIENT", sv: 0 })).toBeNull();
    await Organization.updateOne({ _id: org!._id }, { $set: { status: "PENDING_APPROVAL" } });
  });

  it("team members are pointed to their own inbox", async () => {
    asActor(t.staff);
    expect(await (await chatSessionRoute(req("/api/chat/session"), ctx())).json()).toMatchObject({ state: "team", inboxHref: "/staff/messages" });
    asActor(t.owner);
    expect(await (await chatSessionRoute(req("/api/chat/session"), ctx())).json()).toMatchObject({ state: "team", inboxHref: "/dashboard/messages" });
  });
});

describe("Header auth button status", () => {
  it("tells each role where its own area is; anonymous visitors are not signed in", async () => {
    session.current = null;
    expect(await (await authStatusRoute(req("/api/auth/status"), ctx())).json()).toEqual({ signedIn: false });
    for (const [u, home] of [[t.owner, "/dashboard"], [t.admin, "/staff"], [t.staff, "/staff"], [t.clientA, "/portal"]] as const) {
      asActor(u);
      expect(await (await authStatusRoute(req("/api/auth/status"), ctx())).json()).toMatchObject({ signedIn: true, home });
    }
  });

  it("team members get their own id from the chat session (to tell their messages apart)", async () => {
    asActor(t.admin);
    expect(await (await chatSessionRoute(req("/api/chat/session"), ctx())).json()).toMatchObject({ state: "team", id: t.admin.actor.id });
  });
});

describe("Area routing (proxy)", () => {
  const cookieFor = async (role: string) => `${SESSION_COOKIE}=${await signSession({ sub: String(new Types.ObjectId()), role: role as never, sv: 0 })}`;
  const go = async (path: string, role: string) => proxy(req(path, { headers: { cookie: await cookieFor(role) } }));

  it("the owner dashboard is the owner's only", async () => {
    expect((await go("/dashboard/today", "OWNER")).status).toBe(200);
    for (const role of ["ADMIN", "STAFF"]) {
      const r = await go("/dashboard/companies/no", role);
      expect(r.status).toBe(307);
      expect(new URL(r.headers.get("location")!).pathname).toBe("/staff");
    }
    expect(new URL((await go("/dashboard", "CLIENT")).headers.get("location")!).pathname).toBe("/portal");
  });

  it("links to shared sections open the same page in the staff workspace", async () => {
    const r = await go("/dashboard/messages?c=123", "STAFF");
    expect(r.headers.get("location")).toContain("/staff/messages?c=123");
    expect(new URL((await go("/dashboard/clients/abc", "ADMIN")).headers.get("location")!).pathname).toBe("/staff/clients/abc");
  });

  it("the staff workspace is for ADMIN/STAFF; the owner is sent to the dashboard, clients to their portal", async () => {
    expect((await go("/staff/clients", "STAFF")).status).toBe(200);
    expect(new URL((await go("/staff/clients", "OWNER")).headers.get("location")!).pathname).toBe("/dashboard/clients");
    expect(new URL((await go("/staff", "CLIENT")).headers.get("location")!).pathname).toBe("/portal");
    expect(new URL((await go("/portal", "STAFF")).headers.get("location")!).pathname).toBe("/staff");
  });
});

vi.mock("@/features/auth/verification", async (orig) => ({ ...(await orig<typeof import("@/features/auth/verification")>()), issueAuthCode: vi.fn(async () => undefined) }));
