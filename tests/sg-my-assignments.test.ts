import { describe, expect, it } from "vitest";
import { Company, LeadAssignment, Notification } from "@/models";
import { normalizeAcraRecord, createAcraSgProvider } from "@/features/registry/providers/acra-sg";
import { normalizeSsmExport, createSsmMyProvider } from "@/features/registry/providers/ssm-my";
import { countMyLeads, listMarketerLeads, sendLeadToMarketer, updateLeadOutreachStatus } from "@/features/marketer/service";
import { listLeadAssignments, updateLeadAssignment } from "@/features/marketer/owner-table";
import { mergeIntoMarketerTable } from "@/features/marketer/handoff-migration";
import { ingestCompanies } from "@/features/registry/sync";
import { expectRejects, makeUser } from "./helpers";
import { changeAccess } from "@/features/access/service";
import { loadSessionUser } from "@/lib/auth/actor";
import { getCountry } from "@/config/countries";

describe("Singapore and Malaysia registry records", () => {
  it("exposes ISO identifiers, geography and validates postal codes without losing zeros", async () => {
    expect(getCountry("SG")).toMatchObject({ alpha3: "SGP", administrativeLevel1: "Planning area" });
    expect(getCountry("MY")).toMatchObject({ alpha3: "MYS", administrativeLevel1: "State or Federal Territory" });
    expect(getCountry("SG")!.postalCodePattern!.test("012345")).toBe(true);
    expect(getCountry("SG")!.postalCodePattern!.test("12345")).toBe(false);
    const input = { sourceUrl: "https://www.ssm.com.my/", publishedAt: "2026-11-01T00:00:00Z", records: [{ registrationNumber: "202601000002", name: "Postal fixture", registrationDay: "2026-10-01", businessAddress: { region: " Perlis ", postalCode: "01000", confirmedNonResidential: true } }] };
    const rows = normalizeSsmExport(input);
    expect(rows[0].address.business).toMatchObject({ region: "Perlis", postalCode: "01000", country: "Malaysia" });
    await ingestCompanies(createSsmMyProvider(), "MY", rows);
    expect(await Company.findOne({ countryCode: "MY", sourceId: "202601000002" })).toMatchObject({ postalCode: "01000", region: "Perlis" });
    expect(() => normalizeSsmExport({ ...input, records: [{ ...input.records[0], businessAddress: { ...input.records[0].businessAddress, postalCode: "1000" } }] })).toThrow();
  });
  it("normalizes ACRA identifiers and actual dates without importing residences or contacts", () => {
    const c = normalizeAcraRecord({ uen: "202600001A", entity_name: "Fixture Pte Ltd", registration_incorporation_date: "2026-10-01", entity_status_description: "LIVE COMPANY", postal_code: "123456", street_name: "Private residence", email: "private@example.com" }, new Date("2026-11-01T00:00:00Z"));
    expect(c?.registration.registrationDay).toBe("2026-10-01");
    expect(c?.source.publishedAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(c?.contact).toEqual({}); expect(c?.address).toEqual({}); expect(c?.source.raw).toBeUndefined();
    expect(normalizeAcraRecord({ uen: "invalid", entity_name: "x", registration_incorporation_date: "2026-02-30" })).toBeNull();
    const p = createAcraSgProvider(); expect(p.freshness).toBe("PERIODIC"); expect(p.lookbackDays).toBe(90); expect(p.recommendedSyncMinutes).toBe(1440);
  });
  it("requires authorized Malaysia exports; normalizes and deduplicates imports by new SSM number", async () => {
    const p = createSsmMyProvider();
    const saved = { path: process.env.MALAYSIA_SSM_EXPORT_PATH, authorized: process.env.MALAYSIA_SSM_EXPORT_AUTHORIZED };
    delete process.env.MALAYSIA_SSM_EXPORT_PATH; delete process.env.MALAYSIA_SSM_EXPORT_AUTHORIZED;
    try { expect(p.isConfigured()).toBe(false); expect((await p.checkStatus()).state).toBe("CREDENTIALS_REQUIRED"); }
    finally {
      if (saved.path) process.env.MALAYSIA_SSM_EXPORT_PATH = saved.path;
      if (saved.authorized) process.env.MALAYSIA_SSM_EXPORT_AUTHORIZED = saved.authorized;
    }
    const rows = normalizeSsmExport({ sourceUrl: "https://www.ssm.com.my/", publishedAt: "2026-11-01T00:00:00Z", records: [{ registrationNumber: "202601000001", oldRegistrationNumber: "123456-A", name: "Fixture Sdn Bhd", registrationDay: "2026-10-01" }] });
    expect(rows[0].identity.sourceId).toBe("202601000001");
    expect(rows[0].source.raw).toEqual({ oldRegistrationNumber: "123456-A" });
    await ingestCompanies(p, "MY", rows);
    await ingestCompanies(p, "MY", rows);
    expect(await Company.countDocuments({ countryCode: "MY", sourceId: "202601000001" })).toBe(1);
    expect(normalizeSsmExport({ sourceUrl: "https://www.ssm.com.my/", publishedAt: "2026-11-01T00:00:00Z", records: [] })).toEqual([]);
  });
});

describe("shared and individual assignments", () => {
  it("enforces private scope across listing, stats, updates, notifications, managers and migration", async () => {
    const owner = await makeUser("OWNER");
    const a = await makeUser("DIGITAL_MARKETER"); const b = await makeUser("DIGITAL_MARKETER");
    const admin = await makeUser("ADMIN");
    for (const m of [a, b, admin]) {
      await changeAccess(owner.actor, String(m.user._id), { permission: "marketerLeads.view", action: "grant" });
      m.actor = (await loadSessionUser({ sub: String(m.user._id), role: m.user.role, sv: 0, mf: true }))!.actor;
    }
    const c = await Company.create({ companyName: "Private fixture", countryCode: "SG", source: "fixture", sourceId: "private" });
    const id = String(c._id);
    const result = await sendLeadToMarketer(owner.actor, id, { destinationType: "individual", recipientId: String(a.user._id) });
    expect((await sendLeadToMarketer(owner.actor, id, { destinationType: "individual", recipientId: String(a.user._id) })).status).toBe("already");
    expect((await countMyLeads(a.actor)).total).toBe(1); expect((await countMyLeads(b.actor)).total).toBe(0);
    expect((await listMarketerLeads(b.actor, {})).total).toBe(0);
    expect((await listMarketerLeads(admin.actor, {})).total).toBe(0);
    await expectRejects(listMarketerLeads(b.actor, { scope: "individual", recipientId: String(a.user._id) }), 403);
    await expectRejects(updateLeadOutreachStatus(b.actor, result.assignmentId, { outreachStatus: "MESSAGED" }), 404);
    await updateLeadOutreachStatus(a.actor, result.assignmentId, { outreachStatus: "MESSAGED" });
    expect(await Notification.countDocuments({ userId: b.user._id })).toBe(0);
    await mergeIntoMarketerTable();
    expect((await LeadAssignment.findById(result.assignmentId))?.recipientId?.toString()).toBe(String(a.user._id));
    expect((await listLeadAssignments(owner.actor, { scope: "individual" })).total).toBe(1);
    await updateLeadAssignment(owner.actor, result.assignmentId, { recipientId: String(b.user._id) });
    expect((await countMyLeads(a.actor)).total).toBe(0); expect((await countMyLeads(b.actor)).total).toBe(1);
    expect((await LeadAssignment.findById(result.assignmentId))?.history.some((h: { action: string }) => h.action === "REASSIGNED")).toBe(true);
    await sendLeadToMarketer(owner.actor, id);
    expect((await countMyLeads(a.actor)).total).toBe(1); expect((await countMyLeads(b.actor)).total).toBe(2);
    const inactive = await makeUser("DIGITAL_MARKETER", { status: "SUSPENDED" });
    await expectRejects(sendLeadToMarketer(owner.actor, id, { destinationType: "individual", recipientId: String(inactive.user._id) }), 400);
    await expectRejects(sendLeadToMarketer(b.actor, id), 403);
  });
});
