import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AuditLog, Company, Contact, EmailMessage, LeadAssignment, SuppressionEntry, User, type UserDoc } from "@/models";
import type { SessionUser } from "@/lib/auth/actor";
import { toActor } from "@/lib/auth/actor";
import { can, eligiblePermissions, isGrantable, PERMISSION_DEFS, type Actor, type Permission } from "@/lib/permissions";
import { teamNavigation } from "@/lib/permissions/navigation";
import { classifyCompany, companyTypeOf } from "@/lib/company-classification";
import { contactStatusFilter, contactStatusOf, CONTACT_STATUSES, formatPhone } from "@/lib/company-fields";
import { cleanPhone } from "@/features/registry/normalize-helpers";
import { domainCandidates, extractFromPage } from "@/features/research/website";
import { setEmailProvider, type EmailProvider, type OutgoingEmail } from "@/lib/email/provider";
import { expectRejects, makeOrg, makeUser } from "./helpers";

/**
 * Platform improvements: shared Company Type classification, Contact Status, country-specific
 * contact handling (US / AU / CA / PL), the Manager role and grantable Company Intelligence with
 * server-side enforcement, the Digital Marketer Company Type column, verification-email
 * deliverability and bounce handling. Every record is a fixture in the throw-away database.
 */
const session = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => session.current,
  getActor: async () => session.current?.actor ?? null,
}));

const access = await import("@/features/access/service");
const users = await import("@/features/users/service");
const intel = await import("@/features/companies/intel");
const classification = await import("@/features/companies/classification");
const marketer = await import("@/features/marketer/service");
const { GET: directoryRoute } = await import("@/app/api/company-intel/route");
const { GET: detailRoute, DELETE: deleteRoute } = await import("@/app/api/company-intel/[id]/route");
const { POST: actionRoute } = await import("@/app/api/company-intel/[id]/[action]/route");
const { GET: exportRoute } = await import("@/app/api/company-intel/export/route");
const { GET: ownerCompaniesRoute } = await import("@/app/api/companies/route");
const { POST: accessRoute } = await import("@/app/api/admin/users/[id]/access/route");
const { PUT: templatesRoute } = await import("@/app/api/admin/access/route");

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost:3000"), init);
const ctx = <P extends object>(params: P = {} as P) => ({ params: Promise.resolve(params) });
const json = (url: string, method: string, body: unknown) => req(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function fresh(id: string): Promise<Actor> {
  return toActor((await User.findById(id).lean<UserDoc>())!);
}
async function as(id: string | null) {
  if (!id) return (session.current = null);
  const actor = await fresh(id);
  session.current = { id: actor.id, name: actor.name, email: actor.email, role: actor.role, status: "ACTIVE", emailVerifiedAt: new Date(), actor };
  return actor;
}
let seq = 0;
/** `permissions: null` = no explicit list, so the role template applies (as in the "Add employee" form). */
async function account(o: Actor, role: "ADMIN" | "MANAGER" | "STAFF" | "DIGITAL_MARKETER", permissions: Permission[] | null = []) {
  const n = ++seq;
  const { id } = await users.createInternalUser(o, { name: `${role} ${n}`, email: `pi-${role.toLowerCase()}-${n}@test.local`, role, password: "Strong-test-password-1", ...(permissions && { permissions }) });
  await User.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });
  return id;
}
const grant = async (by: string, to: string, permission: Permission) => access.changeAccess(await fresh(by), to, { permission, action: "grant" });
const revoke = async (by: string, to: string, permission: Permission) => access.changeAccess(await fresh(by), to, { permission, action: "revoke" });

const NOW = new Date("2026-10-28T12:00:00Z");
const yearsAgo = (y: number) => new Date(NOW.getTime() - y * 365.25 * 86_400_000);

let owner: Actor;
let ownerId: string;
let admin: string;
let manager: string;
let marketerA: string;
let staff: string;
let client: Awaited<ReturnType<typeof makeUser>>;
let startupId: Types.ObjectId;
let establishedId: Types.ObjectId;
let reviewId: Types.ObjectId;

beforeAll(async () => {
  owner = (await makeUser("OWNER")).actor;
  ownerId = owner.id;
  admin = await account(owner, "ADMIN");
  manager = await account(owner, "MANAGER");
  marketerA = await account(owner, "DIGITAL_MARKETER");
  staff = await account(owner, "STAFF");
  const org = await makeOrg("Client PI");
  client = await makeUser("CLIENT", { organizationId: org._id, permissions: [] });
  const base = { source: "fixture", isDemo: false };
  const docs = await Company.create([
    { ...base, sourceId: "pi-1", companyName: "Rocket Labs AS", countryCode: "NO", registrationDay: "2026-03-01", registrationDate: new Date("2026-03-01"), eventType: "NEW_ENTITY", status: "Active", email: "post@rocketlabs.example", phone: "+4791234567", directContact: { has: true, hasEmail: true, hasPhone: true, emailVerification: "SOURCE_CONFIRMED" }, research: { status: "CONTACTS_FOUND", attempts: 1 } },
    { ...base, sourceId: "pi-2", companyName: "Old Oak Pty Ltd", countryCode: "AU", registrationDay: "2009-05-04", registrationDate: new Date("2009-05-04"), eventType: "NEW_ENTITY", status: "Registered", website: "https://oldoak.com.au", directContact: { has: false }, research: { status: "EXHAUSTED", attempts: 3 } },
    { ...base, sourceId: "pi-3", companyName: "Midway LLC", countryCode: "US", registrationDay: "2022-06-01", registrationDate: new Date("2022-06-01"), eventType: "NEW_ENTITY", status: "Active", directContact: { has: false }, research: { status: "NOT_STARTED", attempts: 0 } },
  ]);
  [startupId, establishedId, reviewId] = docs.map((d) => d._id);
  await classification.reclassifyCompanies({ now: NOW });
});

describe("Item 6/8 · one shared Company Type classification", () => {
  it("never uses age alone and sends unsupported cases to Needs Review", () => {
    expect(classifyCompany({ registrationDate: yearsAgo(1), eventType: "NEW_ENTITY" }, NOW).value).toBe("STARTUP");
    expect(classifyCompany({ registrationDate: yearsAgo(1), eventType: "NEW_ENTITY", employees: 400 }, NOW).value).toBe("NEEDS_REVIEW"); // likely subsidiary
    expect(classifyCompany({ registrationDate: yearsAgo(12), eventType: "NEW_ENTITY", status: "Active" }, NOW).value).toBe("ESTABLISHED");
    expect(classifyCompany({ registrationDate: yearsAgo(12), eventType: "NEW_ENTITY", status: "Dissolved" }, NOW).value).toBe("NEEDS_REVIEW");
    expect(classifyCompany({ registrationDate: yearsAgo(4), eventType: "NEW_ENTITY" }, NOW).value).toBe("NEEDS_REVIEW");
    expect(classifyCompany({ registrationDate: yearsAgo(4), eventType: "NEW_ENTITY", employees: 25 }, NOW).value).toBe("ESTABLISHED");
    expect(classifyCompany({ registrationDate: yearsAgo(1), eventType: "BRANCH" }, NOW).value).toBe("NEEDS_REVIEW");
    expect(classifyCompany({ eventType: "NEW_ENTITY" }, NOW).value).toBe("NEEDS_REVIEW"); // no date → never guessed
    expect(companyTypeOf(undefined)).toBe("NEEDS_REVIEW");
  });

  it("classifies stored records, keeps manual decisions and exposes the same value to Digital Marketers", async () => {
    const types = Object.fromEntries((await Company.find({ sourceId: /^pi-/ }).lean<{ sourceId: string; companyType?: { value?: string } }[]>()).map((c) => [c.sourceId, c.companyType?.value]));
    expect(types).toEqual({ "pi-1": "STARTUP", "pi-2": "ESTABLISHED", "pi-3": "NEEDS_REVIEW" });

    await grant(ownerId, admin, "companies.edit");
    await expectRejects(classification.setCompanyType(await fresh(staff), String(reviewId), { value: "STARTUP" }), 403);
    await classification.setCompanyType(await fresh(admin), String(reviewId), { value: "STARTUP" });
    await classification.reclassifyCompanies({ now: NOW }); // automatic re-evaluation never overwrites a manual decision
    expect((await Company.findById(reviewId).lean<{ companyType?: object }>())!.companyType).toMatchObject({ value: "STARTUP", manual: true });
    expect(await AuditLog.exists({ action: "company.type_changed", entityId: String(reviewId) })).toBeTruthy();

    // Marketer table reads the same stored value (no separate logic).
    await LeadAssignment.create({ companyId: reviewId, recipientId: null, senderId: new Types.ObjectId(ownerId), countryCode: "US", status: "ACTIVE", sentAt: new Date(), history: [] });
    await LeadAssignment.create({ companyId: establishedId, recipientId: null, senderId: new Types.ObjectId(ownerId), countryCode: "AU", status: "ACTIVE", sentAt: new Date(), history: [] });
    await grant(ownerId, marketerA, "marketerLeads.view");
    const page = await marketer.listMarketerLeads(await fresh(marketerA), {});
    expect(Object.fromEntries(page.items.map((r) => [r.companyName, r.companyType.value]))).toEqual({ "Midway LLC": "STARTUP", "Old Oak Pty Ltd": "ESTABLISHED" });
    expect(page.stats).toMatchObject({ total: 2, startup: 1, established: 1, review: 0, withWebsite: 1 });
    const onlyEstablished = await marketer.listMarketerLeads(await fresh(marketerA), { type: "established" });
    expect(onlyEstablished.items.map((r) => r.companyName)).toEqual(["Old Oak Pty Ltd"]);

    await classification.setCompanyType(await fresh(admin), String(reviewId), { value: "AUTO" });
    expect((await Company.findById(reviewId).lean<{ companyType?: object }>())!.companyType).toMatchObject({ value: "NEEDS_REVIEW", manual: false });
  });
});

describe("Item 4 · contact status and country-specific contact handling", () => {
  it("Contact Status: the value function and the database filter agree", async () => {
    const all = await Company.find({ sourceId: /^pi-/ }).lean();
    for (const s of CONTACT_STATUSES) {
      const viaFilter = (await Company.find({ sourceId: /^pi-/, ...contactStatusFilter(s) }).lean()).map((c) => c.sourceId).sort();
      const viaValue = all.filter((c) => contactStatusOf({ direct: { has: !!c.directContact?.has, emailVerification: c.directContact?.emailVerification, phoneVerification: c.directContact?.phoneVerification, pendingVerification: !!c.directContact?.pendingVerification }, research: { status: c.research?.status, attempts: c.research?.attempts } }) === s).map((c) => c.sourceId).sort();
      expect(viaFilter, s).toEqual(viaValue);
    }
    expect(contactStatusOf({ direct: { has: false }, research: { status: "EXHAUSTED", attempts: 2 } })).toBe("NOT_PUBLICLY_AVAILABLE");
    expect(contactStatusOf({ direct: { has: false }, research: { status: "NOT_STARTED", attempts: 0 } })).toBe("PENDING"); // never claimed "not available" before research
    expect(contactStatusOf({ direct: { has: true, emailVerification: "DELIVERABLE" }, research: {} })).toBe("VERIFIED");
  });

  it("US / Canada / Australia numbers are normalised with international dialing codes and formatted for display", () => {
    expect(cleanPhone("(212) 555-0100", "US")).toBe("+12125550100");
    expect(cleanPhone("1-800-555-0100", "US")).toBe("+18005550100");
    expect(cleanPhone("011 44 20 7946 0958", "US")).toBe("+442079460958");
    expect(cleanPhone("555-0100", "US")).toBe("555-0100"); // too short: kept as published, never padded
    expect(cleanPhone("(02) 9374 4000", "AU")).toBe("+61293744000");
    expect(cleanPhone("0412 345 678", "AU")).toBe("+61412345678");
    expect(formatPhone("+12125550100")).toBe("+1 212 555 0100");
    expect(formatPhone("+61293744000")).toBe("+61 2 9374 4000");
    expect(formatPhone("+61412345678")).toBe("+61 412 345 678");
    expect(formatPhone("+4791234567")).toBe("+47 912 34 567");
    expect(formatPhone("+48221234567")).toBe("+48 221 234 567");
  });

  it("website discovery now covers US, Canada, Australia, Poland and Japan (verified on the page before use)", () => {
    expect(domainCandidates("ACME HOLDINGS, LLC", "US")).toEqual(["acmeholdings.com", "acme-holdings.com"]);
    expect(domainCandidates("BLUE GUM PTY. LTD.", "AU")).toEqual(["bluegum.com.au", "blue-gum.com.au", "bluegum.au"]);
    expect(domainCandidates("Maple Leaf Inc.", "CA")[0]).toBe("mapleleaf.ca");
    expect(domainCandidates("Nowak Software sp. z o.o.", "PL")[0]).toBe("nowaksoftware.pl");
    const page = `<html><body><p>Phone: (212) 555-0100</p><a href="mailto:hello@acmeholdings.com">Email</a></body></html>`;
    const found = extractFromPage(page, "https://acmeholdings.com/contact", "US");
    expect(found.phones.map((p) => p.value)).toEqual(["+12125550100"]);
    expect(found.emails[0]).toMatchObject({ value: "hello@acmeholdings.com", onOwnDomain: true });
  });

  it("a generic inbox is never shown as a person's email; owner/decision-maker email only when published with a name", async () => {
    await Contact.create([
      { companyId: startupId, countryCode: "NO", type: "EMAIL", value: "post@rocketlabs.example", sourceKind: "WEBSITE", source: "Company website", sourceUrl: "https://rocketlabs.example/kontakt", emailVerification: "SOURCE_CONFIRMED" },
      { companyId: startupId, countryCode: "NO", type: "EMAIL", value: "kari@rocketlabs.example", personName: "Kari Nordmann", role: "CEO", sourceKind: "ENRICHMENT", source: "Hunter Domain Search", emailVerification: "DELIVERABLE" },
    ]);
    const d = await intel.getIntelDetail(owner, String(startupId));
    const byValue = Object.fromEntries(d.emails.map((e) => [e.value, e]));
    expect(byValue["post@rocketlabs.example"]).toMatchObject({ kind: "Business inbox", sourceUrl: "https://rocketlabs.example/kontakt" });
    expect(byValue["kari@rocketlabs.example"]).toMatchObject({ kind: "Named person", personName: "Kari Nordmann", role: "CEO" });
  });
});

describe("Items 2 & 5 · roles, service permissions and server-side enforcement", () => {
  it("the Manager role exists, starts with nothing and is eligible for client-service work only as granted", async () => {
    expect(can(await fresh(manager), "clients.manage")).toBe(false);
    await grant(ownerId, manager, "clients.manage");
    expect(can(await fresh(manager), "clients.manage")).toBe(true);
    expect(eligiblePermissions("MANAGER")).not.toContain("users.manage");
    await expectRejects(grant(ownerId, manager, "users.manage"), 403);
  });

  it("Owner-only tools can never be granted; clients can never receive team permissions", async () => {
    for (const p of ["registry.sync", "leads.manage", "leads.sendToMarketer", "outreach.manage", "outreach.approve", "settings.manage", "audit.view", "mailbox.view", "emailSender.use"] as Permission[]) {
      expect(isGrantable(p)).toBe(false);
      await expectRejects(grant(ownerId, admin, p), 403);
    }
    expect(PERMISSION_DEFS["companies.read"].eligibleRoles).not.toContain("CLIENT");
    expect(can({ ...client.actor, permissions: ["companies.read"] }, "companies.read")).toBe(false);
    await expectRejects(access.changeAccess(owner, String(client.user._id), { permission: "companies.read", action: "grant" }), 404);
  });

  it("Company Intelligence is per-person: no grant → 403 everywhere; view → directory only; export / delete need their own grant", async () => {
    await as(marketerA);
    expect(teamNavigation((await fresh(marketerA))!).flatMap((g) => g.items).some((i) => i.href === "/staff/companies")).toBe(false);
    expect((await directoryRoute(req("/api/company-intel"), ctx())).status).toBe(403);

    await grant(ownerId, marketerA, "companies.read");
    const m = await as(marketerA);
    expect(teamNavigation(m!).flatMap((g) => g.items).some((i) => i.href === "/staff/companies")).toBe(true);
    const list = await directoryRoute(req("/api/company-intel?type=established"), ctx());
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { name: string; type: string }[]; counts: Record<string, number>; abilities: Record<string, boolean> };
    expect(body.items.map((r) => r.name)).toEqual(["Old Oak Pty Ltd"]);
    expect(body.counts).toMatchObject({ all: 3, startup: 1, established: 1, review: 1 });
    expect(body.abilities).toEqual({ edit: false, export: false, delete: false });
    expect(JSON.stringify(body)).not.toMatch(/"lead"|scoreBreakdown|sourceData/); // no CRM or raw source data
    expect((await detailRoute(req(`/api/company-intel/${establishedId}`), ctx({ id: String(establishedId) }))).status).toBe(200);
    expect((await exportRoute(req("/api/company-intel/export"), ctx())).status).toBe(403);
    expect((await actionRoute(json(`/api/company-intel/${establishedId}/type`, "POST", { value: "STARTUP" }), ctx({ id: String(establishedId), action: "type" }))).status).toBe(403);
    expect((await deleteRoute(req(`/api/company-intel/${establishedId}`, { method: "DELETE" }), ctx({ id: String(establishedId) }))).status).toBe(403);
    // The Owner workspace APIs (CRM, research, registry) stay Owner-only even with the view grant.
    expect((await ownerCompaniesRoute(req("/api/companies?country=NO"), ctx())).status).toBe(403);

    await grant(ownerId, marketerA, "companies.export");
    await as(marketerA);
    const csv = await exportRoute(req("/api/company-intel/export?country=AU"), ctx());
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toContain("Company type");
    expect(text).toContain("Old Oak Pty Ltd");
    expect(text).toContain("Established Company");

    // Delete is Admin-only and needs its own grant.
    await expectRejects(grant(ownerId, marketerA, "companies.delete"), 403);
    await revoke(ownerId, marketerA, "companies.read");
    await as(marketerA);
    expect((await directoryRoute(req("/api/company-intel"), ctx())).status).toBe(403); // revocation applies to the very next request
  });

  it("clients get 403 from every Company Intelligence API (data isolation)", async () => {
    session.current = { id: client.actor.id, name: client.actor.name, email: client.actor.email, role: "CLIENT", status: "ACTIVE", organizationId: client.actor.organizationId, organizationStatus: "ACTIVE", emailVerifiedAt: new Date(), actor: client.actor };
    expect((await directoryRoute(req("/api/company-intel"), ctx())).status).toBe(403);
    expect((await detailRoute(req(`/api/company-intel/${establishedId}`), ctx({ id: String(establishedId) }))).status).toBe(403);
    expect((await exportRoute(req("/api/company-intel/export"), ctx())).status).toBe(403);
  });

  it("an Admin passes on Company Intelligence view only with both permissions; losing authority cascades", async () => {
    await expectRejects(grant(admin, staff, "companies.read"), 403);
    await grant(ownerId, admin, "companies.read");
    await grant(ownerId, admin, "companies.grant");
    await grant(admin, staff, "companies.read");
    expect(can(await fresh(staff), "companies.read")).toBe(true);
    await expectRejects(grant(admin, staff, "companies.export"), 403); // scoped to view only
    await revoke(ownerId, admin, "companies.grant");
    expect(can(await fresh(staff), "companies.read")).toBe(false);
    expect(await AuditLog.exists({ action: "permission.revoked", entityId: staff, "metadata.reason": "CASCADE_GRANTOR_LOST_AUTHORITY" })).toBeTruthy();
  });

  it("no privilege escalation: nobody changes their own access, marketers can't open permission management", async () => {
    await expectRejects(grant(admin, admin, "users.manage"), 403);
    await as(marketerA);
    expect((await accessRoute(json(`/api/admin/users/${staff}/access`, "POST", { permission: "companies.read", action: "grant" }), ctx({ id: staff }))).status).toBe(403);
    expect((await templatesRoute(json("/api/admin/access", "PUT", { role: "STAFF", permissions: ["companies.read"] }), ctx())).status).toBe(403);
    await as(admin);
    expect((await templatesRoute(json("/api/admin/access", "PUT", { role: "STAFF", permissions: ["companies.read"] }), ctx())).status).toBe(403); // Owner only
  });

  it("service toggles and templates apply individually audited changes", async () => {
    const target = await account(owner, "DIGITAL_MARKETER");
    await as(ownerId);
    const res = await accessRoute(json(`/api/admin/users/${target}/access`, "POST", { preset: "marketer-full" }), ctx({ id: target }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { applied: number; refused: unknown[]; view: { effective: string[] } };
    expect(out.refused).toEqual([]);
    expect(new Set(out.view.effective)).toEqual(new Set(["marketerLeads.view", "companies.read", "companies.edit", "companies.export", "opportunities.view"]));
    expect(await AuditLog.countDocuments({ action: "permission.granted", entityId: target })).toBe(5);

    // Service switch off = one bulk request revoking every permission of that service.
    const off = await accessRoute(json(`/api/admin/users/${target}/access`, "POST", { changes: ["companies.read", "companies.edit", "companies.export"].map((permission) => ({ permission, action: "revoke" })) }), ctx({ id: target }));
    expect(((await off.json()) as { view: { effective: string[] } }).view.effective.sort()).toEqual(["marketerLeads.view", "opportunities.view"]);
  });

  it("the Owner customises a role template and can apply it to everyone with that role", async () => {
    await as(ownerId);
    const res = await templatesRoute(json("/api/admin/access", "PUT", { role: "MANAGER", permissions: ["analytics.view", "companies.read"], applyToExisting: true }), ctx());
    expect(res.status).toBe(200);
    expect((await access.getRoleTemplates()).MANAGER.sort()).toEqual(["analytics.view", "companies.read"]);
    expect(new Set((await fresh(manager)).permissions)).toEqual(new Set(["analytics.view", "companies.read"]));
    // New Manager accounts start from the template.
    const newManager = await account(owner, "MANAGER", null);
    expect(new Set((await fresh(newManager)).permissions)).toEqual(new Set(["analytics.view", "companies.read"]));
    await expectRejects(access.setRoleTemplate(owner, { role: "STAFF", permissions: ["companies.export"] }), 400); // not eligible for Staff
  });
});

describe("Item 1 · verification email deliverability", () => {
  it("sends a link-free, code-first email with transactional headers and redacts the code in the log; rate-limited per hour", async () => {
    const sent: OutgoingEmail[] = [];
    const provider: EmailProvider = { id: "test-live", isLive: true, send: async (e) => (sent.push(e), { id: `m-${sent.length}` }) };
    setEmailProvider(provider);
    const { issueAuthCode } = await import("@/features/auth/verification");
    const u = await User.create({ name: "Ada Lovelace", email: "ada-verify@test.local", role: "CLIENT", status: "PENDING_APPROVAL" });
    await issueAuthCode(u, "VERIFY");
    const mail = sent[0]!;
    const code = /(\d{6}) is your ExploreTechify verification code/.exec(mail.subject)?.[1];
    expect(code).toBeTruthy();
    expect(mail.text).toContain(code!);
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.html).toContain(code!);
    expect(mail.html).not.toMatch(/<a\s|<img\s|https?:\/\//i); // no links, images or tracking
    expect(mail.headers).toMatchObject({ "Auto-Submitted": "auto-generated" });
    expect(mail.headers?.["X-Entity-Ref-ID"]).toBeTruthy();
    const record = await EmailMessage.findOne({ to: "ada-verify@test.local" }).lean();
    expect(record).toMatchObject({ category: "VERIFICATION", subject: "[Security message]", body: "[Security message redacted]", status: "SENT" });
    expect(JSON.stringify(record)).not.toContain(code!);

    // Hourly cap per address (on top of the 60-second resend lock).
    await EmailMessage.insertMany(Array.from({ length: 5 }, () => ({ kind: "TRANSACTIONAL", category: "VERIFICATION", to: "ada-verify@test.local", subject: "x", body: "x", status: "SENT" })));
    await User.updateOne({ _id: u._id }, { $set: { authCodeSentAt: new Date(Date.now() - 120_000) } });
    await expectRejects(issueAuthCode(u, "VERIFY"), 429);
  });

  it("records bounces: message BOUNCED, contact BOUNCED (no longer a direct contact), address suppressed for outreach", async () => {
    const { parseBounce, recordBounce } = await import("@/lib/email/deliverability");
    const dsn = ["From: MAILER-DAEMON@mx.zoho.com", "Subject: Undelivered Mail Returned to Sender", "", "Reporting-MTA: dns; mx.zoho.com", "Final-Recipient: rfc822; gone@rocketlabs.example", "Action: failed", "Status: 5.1.1", "Diagnostic-Code: smtp; 550 5.1.1 User unknown"].join("\r\n");
    const parsed = parseBounce(dsn, ["hello@exploretechify.com"]);
    expect(parsed).toEqual({ recipient: "gone@rocketlabs.example", diagnostic: "smtp; 550 5.1.1 User unknown" });
    await EmailMessage.create({ kind: "DIRECT", to: "gone@rocketlabs.example", subject: "Hello", body: "x", status: "SENT" });
    await Contact.create({ companyId: startupId, countryCode: "NO", type: "EMAIL", value: "gone@rocketlabs.example", sourceKind: "WEBSITE", source: "site", emailVerification: "SOURCE_CONFIRMED" });
    const r = await recordBounce(parsed!.recipient, parsed!.diagnostic);
    expect(r).toMatchObject({ message: true, hard: true, contacts: 1 });
    expect((await EmailMessage.findOne({ to: "gone@rocketlabs.example" }).lean<{ status: string }>())!.status).toBe("BOUNCED");
    expect((await Contact.findOne({ value: "gone@rocketlabs.example" }).lean<{ emailVerification?: string }>())!.emailVerification).toBe("BOUNCED");
    expect(await SuppressionEntry.exists({ email: "gone@rocketlabs.example", reason: "BOUNCE" })).toBeTruthy();
  });
});

describe("Team directory and Client Leads outreach status", () => {
  it("team workspace keeps one Companies entry; the directory still filters by Company Type", async () => {
    await grant(ownerId, marketerA, "companies.read");
    const items = teamNavigation((await fresh(marketerA))!).find((g) => g.id === "company-intelligence")!.items;
    expect(items.map((i) => [i.label, i.href])).toEqual([["Companies", "/staff/companies"]]);
    // Type filters show only their own records (same shared classification).
    const startups = await intel.listDirectory(await fresh(marketerA), { type: "startup" });
    const established = await intel.listDirectory(await fresh(marketerA), { type: "established" });
    expect(startups.items.every((r) => r.type === "STARTUP") && startups.items.length > 0).toBe(true);
    expect(established.items.map((r) => r.name)).toEqual(["Old Oak Pty Ltd"]);
    await revoke(ownerId, marketerA, "companies.read");
  });

  it("every lead defaults to Not reached; a change is saved per lead, persists, and never touches other leads or marketers", async () => {
    const { PATCH: outreachRoute } = await import("@/app/api/marketer/leads/[id]/route");
    const me = await fresh(marketerA);
    const before = await marketer.listMarketerLeads(me, {});
    expect(before.items.length).toBeGreaterThanOrEqual(2);
    expect(before.items.every((r) => r.outreachStatus === "NOT_REACHED")).toBe(true);
    const [first, second] = before.items;

    await as(marketerA);
    const res = await outreachRoute(json(`/api/marketer/leads/${first!.id}`, "PATCH", { outreachStatus: "MESSAGED" }), ctx({ id: first!.id }));
    expect(res.status).toBe(200);
    expect((await outreachRoute(json(`/api/marketer/leads/${first!.id}`, "PATCH", { outreachStatus: "SOMETHING" }), ctx({ id: first!.id }))).status).toBe(400);

    // A fresh read (page refresh / new session) returns the saved value; the other lead is unchanged.
    const after = await marketer.listMarketerLeads(await fresh(marketerA), {});
    const byId = Object.fromEntries(after.items.map((r) => [r.id, r.outreachStatus]));
    expect(byId[first!.id]).toBe("MESSAGED");
    expect(byId[second!.id]).toBe("NOT_REACHED");
    await marketer.updateLeadOutreachStatus(await fresh(marketerA), first!.id, { outreachStatus: "GOT_RESPONSE" });
    expect((await LeadAssignment.findById(first!.id).lean<{ outreachStatus?: string; history: { action: string }[] }>())!).toMatchObject({ outreachStatus: "GOT_RESPONSE" });
    expect(await AuditLog.exists({ action: "lead.outreach_status_changed", "metadata.assignmentId": first!.id })).toBeTruthy();

    // The table is shared: another marketer may update the status too (recorded as theirs); staff never can.
    const other = await account(owner, "DIGITAL_MARKETER", ["marketerLeads.view"]);
    await expectRejects(marketer.updateLeadOutreachStatus(await fresh(staff), first!.id, { outreachStatus: "NOT_REACHED" }), 403);
    await marketer.updateLeadOutreachStatus(await fresh(other), first!.id, { outreachStatus: "NOT_REACHED" });
    const shared = (await LeadAssignment.findById(first!.id).lean<{ outreachStatus?: string; outreachStatusBy?: unknown }>())!;
    expect(shared.outreachStatus).toBe("NOT_REACHED");
    expect(String(shared.outreachStatusBy)).toBe(other);
  });
});

describe("Item 7 · established-company collection", () => {
  it("keeps only active, numbered companies past the Old company Intelligence threshold (see intel-separation.test.ts)", async () => {
    const { selectEstablished } = await import("@/features/registry/established");
    const rec = (day: string, status?: string) => ({ identity: { sourceId: day + status, name: "X", registrationNumber: day + status }, registration: { registrationDay: day, status }, classification: {}, contact: {}, address: {}, source: {} }) as never;
    const kept = selectEstablished([rec("2015-03-02", "Active"), rec("2015-03-02", "Dissolved"), rec("2026-01-10", "Active")], 5, NOW);
    expect(kept).toHaveLength(1);
  });
});
