import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Notification, User, type CompanyDoc, type UserDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { toActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/permissions";
import { toCompanyRow } from "@/features/companies/rows";
import { ToastProvider } from "@/components/ui/toast";
import { RegistrationsTable } from "@/components/intel/registrations-table";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { expectRejects, makeTenants, makeUser } from "./helpers";

/**
 * 1. "Send to Marketer" replaces "View" in Today's New Companies.
 * 2. Owner / Super Admin add employees directly (no invitation or approval step).
 * 3. Opening a notification marks only that notification read.
 * Isolated fixtures in the throw-away test database.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const users = await import("@/features/users/service");
const notifications = await import("@/features/notifications/service");
const { POST: createRoute } = await import("@/app/api/admin/users/route");
const { GET: lookupRoute } = await import("@/app/api/admin/users/lookup/route");
const { POST: notificationsRoute } = await import("@/app/api/notifications/route");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = () => ({ params: Promise.resolve({}) });
const post = (url: string, body: unknown) => req(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function as(actor: Actor | null) {
  session.current = actor ? { id: actor.id, name: actor.name, email: actor.email, role: actor.role, status: "ACTIVE", organizationId: actor.organizationId, organizationStatus: "ACTIVE", emailVerifiedAt: new Date(), actor } : null;
}
const fresh = async (id: unknown) => toActor((await User.findById(id).lean<UserDoc>())!);

let t: Awaited<ReturnType<typeof makeTenants>>;
beforeAll(async () => {
  t = await makeTenants();
});

/* ───────────── 1. Send to Marketer replaces View ───────────── */

describe("Today's New Companies row action", () => {
  const company = { _id: new Types.ObjectId(), companyName: "Row Action AS", countryCode: "NO", registrationNumber: "912345678", registrationDay: "2026-10-27", lead: { stage: "NEW" } } as unknown as CompanyDoc;
  const render = (canSend: boolean) =>
    renderToStaticMarkup(
      <ToastProvider>
        <RegistrationsTable rows={[toCompanyRow(company)]} capabilities={{}} canQualify canSendToMarketer={canSend} />
      </ToastProvider>,
    );

  it("shows Send to Marketer instead of View, once per row on desktop", () => {
    const html = render(true);
    const desktop = html.slice(0, html.indexOf("md:hidden"));
    expect(desktop).not.toMatch(/>\s*View\s*</);
    expect(desktop).not.toContain("Quick view Row Action AS");
    expect(desktop.match(/<span>Send to Marketer<\/span>/g)).toHaveLength(1);
    // The company name still opens the quick view.
    expect(desktop).toContain("Row Action AS");
  });

  it("other row actions stay: qualification buttons are still there", () => {
    expect(render(true)).toContain('aria-label="Qualification"');
  });

  it("is not offered to someone who may not send leads", () => {
    expect(render(false)).not.toContain("Send to Marketer");
  });
});

/* ───────────── 2. Direct employee addition ───────────── */

describe("Owner and Super Admin add employees directly", () => {
  it("Owner: active immediately, visible in the list, default access, who and when recorded", async () => {
    const res = await users.createInternalUser(t.owner.actor, { name: "Direct Staff", email: "direct-staff@test.local", role: "STAFF", password: "Strong-direct-pass-1" });
    expect(res.linked).toBe(false);
    const u = await User.findById(res.id).lean<UserDoc & { addedBy?: Types.ObjectId; addedAt?: Date }>();
    expect(u).toMatchObject({ status: "ACTIVE", role: "STAFF" });
    expect(String(u!.addedBy)).toBe(t.owner.actor.id);
    expect(u!.addedAt).toBeInstanceOf(Date);
    expect((await fresh(res.id)).permissions).toEqual(expect.arrayContaining(["tickets.assigned", "chat.manage"]));
    const list = await users.listInternalUsersAdmin(t.owner.actor, { q: "direct-staff" });
    expect(list.items.map((x) => x.email)).toContain("direct-staff@test.local");
    expect(await AuditLog.exists({ action: "user.created", entityId: res.id })).toBeTruthy();
  });

  it("Super Admin (with Manage Staff Accounts) adds a staff member through the API", async () => {
    as(t.admin.actor);
    const res = await createRoute(post("/api/admin/users", { name: "Admin Added", email: "admin-added@test.local", role: "STAFF", password: "Strong-direct-pass-2" }), ctx());
    expect(res.status).toBe(200);
    const u = await User.findOne({ email: "admin-added@test.local" }).lean<UserDoc & { addedBy?: Types.ObjectId }>();
    expect(u?.status).toBe("ACTIVE");
    expect(String(u?.addedBy)).toBe(t.admin.actor.id);
  });

  it("blocks unauthorised roles on the backend", async () => {
    const marketer = await makeUser("DIGITAL_MARKETER", { permissions: [] });
    for (const a of [t.staff.actor, marketer.actor, t.clientA.actor]) {
      as(a);
      expect((await createRoute(post("/api/admin/users", { name: "Nope", email: `nope-${a.id}@test.local`, role: "STAFF", password: "Strong-direct-pass-3" }), ctx())).status).toBe(403);
      expect((await lookupRoute(req("/api/admin/users/lookup?email=x@test.local"), ctx())).status).toBe(403);
    }
    await expectRejects(users.createInternalUser(t.admin.actor, { name: "Admin Two", email: "admin-two@test.local", role: "ADMIN", password: "Strong-direct-pass-4" }), 403);
  });

  it("prevents duplicates and never touches a client account", async () => {
    await expectRejects(users.createInternalUser(t.owner.actor, { name: "Again", email: "direct-staff@test.local", role: "STAFF", password: "Strong-direct-pass-5" }), 409);
    const client = await User.findById(t.clientA.user._id).select("+passwordHash").lean<UserDoc & { passwordHash?: string }>();
    await expectRejects(users.createInternalUser(t.owner.actor, { name: "Client As Staff", email: client!.email, role: "STAFF", password: "Strong-direct-pass-6" }), 409);
    const after = await User.findById(t.clientA.user._id).select("+passwordHash").lean<UserDoc & { passwordHash?: string }>();
    expect(after).toMatchObject({ role: "CLIENT", name: client!.name, passwordHash: client!.passwordHash, organizationId: client!.organizationId });
    expect(await users.lookupEmployeeCandidate(t.owner.actor, client!.email)).toMatchObject({ status: "BLOCKED" });
    expect(await users.lookupEmployeeCandidate(t.owner.actor, "direct-staff@test.local")).toMatchObject({ status: "MEMBER" });
    expect(await users.lookupEmployeeCandidate(t.owner.actor, "brand-new@test.local")).toMatchObject({ status: "NEW" });
  });

  it("activates an invited-but-never-activated account without changing its details", async () => {
    const pending = await User.create({ name: "Invited Person", email: "invited@test.local", role: "STAFF", status: "PENDING_APPROVAL", invitationTokenHash: "abc", passwordHash: "existing-hash" });
    expect(await users.lookupEmployeeCandidate(t.owner.actor, "invited@test.local")).toMatchObject({ status: "LINKABLE" });
    const res = await users.createInternalUser(t.owner.actor, { name: "Other Name", email: "invited@test.local", role: "DIGITAL_MARKETER" });
    expect(res).toMatchObject({ id: String(pending._id), linked: true, needsPassword: false });
    const u = await User.findById(pending._id).select("+passwordHash +invitationTokenHash").lean<UserDoc & { passwordHash?: string; invitationTokenHash?: string }>();
    expect(u).toMatchObject({ status: "ACTIVE", name: "Invited Person", role: "STAFF", passwordHash: "existing-hash" });
    expect(u!.invitationTokenHash).toBeUndefined();
    expect(await User.countDocuments({ email: "invited@test.local" })).toBe(1);
  });

  it("a new account needs an initial password; none is generated", async () => {
    await expectRejects(users.createInternalUser(t.owner.actor, { name: "No Password", email: "no-pass@test.local", role: "STAFF" }), 400);
    expect(await User.exists({ email: "no-pass@test.local" })).toBeNull();
  });
});

/* ───────────── 3. Opening a notification marks it read ───────────── */

describe("Opening a notification marks that notification read", () => {
  it("marks only the opened one, persists, never flips back, and only for its owner", async () => {
    const me = t.staff.actor;
    const [a, b] = await Notification.create([
      { userId: me.id, type: "SYSTEM", title: "First" },
      { userId: me.id, type: "SYSTEM", title: "Second" },
    ]);
    const other = await Notification.create({ userId: t.admin.actor.id, type: "SYSTEM", title: "Someone else's" });
    expect(await notifications.unreadNotificationCount(me.id)).toBe(2);

    as(me);
    expect((await notificationsRoute(post("/api/notifications", { ids: [String(a!._id)] }), ctx())).status).toBe(200);
    expect(await notifications.unreadNotificationCount(me.id)).toBe(1);
    const readAt = (await Notification.findById(a!._id).lean<{ readAt?: Date }>())!.readAt;
    expect(readAt).toBeInstanceOf(Date);
    expect((await Notification.findById(b!._id).lean<{ readAt?: Date | null }>())!.readAt ?? null).toBeNull();

    // Reopening keeps it read (same timestamp).
    await notificationsRoute(post("/api/notifications", { ids: [String(a!._id)] }), ctx());
    expect((await Notification.findById(a!._id).lean<{ readAt?: Date }>())!.readAt?.getTime()).toBe(readAt!.getTime());

    // Another user's notification is never touched.
    await notificationsRoute(post("/api/notifications", { ids: [String(other._id)] }), ctx());
    expect((await Notification.findById(other._id).lean<{ readAt?: Date | null }>())!.readAt ?? null).toBeNull();
  });

  it("the notification list renders unread rows as openable items with an indicator", async () => {
    const { NotificationItems } = await import("@/components/app/notification-items");
    const { LiveCountsProvider } = await import("@/components/app/live-counts");
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider value={{ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} } as never}>
      <ToastProvider>
        <LiveCountsProvider initial={{ messages: 0, notifications: 1 }}>
          <NotificationItems items={[{ id: "1", title: "Unread one", type: "SYSTEM", read: false, updatedAt: new Date().toISOString() }, { id: "2", title: "Read one", type: "SYSTEM", read: true, link: "/staff", updatedAt: new Date().toISOString() }]} />
        </LiveCountsProvider>
      </ToastProvider>
      </AppRouterContext.Provider>,
    );
    expect(html.match(/aria-label="Unread"/g)).toHaveLength(1);
    expect(html).toContain("<button");
    expect(html).toContain('href="/staff"');
  });
});
