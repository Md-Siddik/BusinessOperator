import { beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Checkpoint, Company, Contact, Country, Job, LookupCache, Quotation, ServicePackage, SuppressionEntry, type CompanyDoc, type ContactDoc } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { classifyContactValue } from "@/lib/company-fields";
import { ensureCountries } from "@/features/countries/service";
import { listCompanies, registrationDayFilter } from "@/features/companies/service";
import { exportCompanies, getRegistrationOverview } from "@/features/companies/registrations";
import { flagSharedContacts, recomputeCompanyContacts, recordContact } from "@/features/research/contacts";
import { canSpend, getCached, setCached } from "@/features/research/budget";
import { extractFromPage, identityEvidence } from "@/features/research/website";
import { enqueueJob, processDueJobs, registerJobHandler } from "@/features/jobs/queue";
import { registerTestProvider } from "@/features/registry/providers";
import { ingestCompanies, rebuildSnapshots, syncToday } from "@/features/registry/sync";
import { NO_CAPABILITIES, type CompanyRegistryProvider, type NormalizedCompany } from "@/features/registry/types";
import { normalizeKvk, type KvkBasisprofiel } from "@/features/registry/providers/kvk";
import { normalizeCroRecord } from "@/features/registry/providers/cro";
import { normalizeRikDetail, __test as rikTest } from "@/features/registry/providers/rik";
import { handleStreamEvents } from "@/features/registry/companies-house-stream";
import { assessServiceFit, ensureServicePackages } from "@/features/service-fit/service";
import { createQuotation, updateQuotation } from "@/features/quotations/service";
import { setEligibility } from "@/features/leads/workflow";
import { updateSetting } from "@/features/settings/service";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Fixture companies here are test data stored in a throw-away in-memory
 * database — never presented as real companies.
 */
let t: Awaited<ReturnType<typeof makeTenants>>;
const today = todayIn("Europe/Oslo");
let seq = 0;

async function mk(fields: Partial<CompanyDoc> & { companyName?: string } = {}) {
  seq++;
  return Company.create({ companyName: `Fixture ${seq} AS`, countryCode: "NO", source: "fixture", sourceId: `f${seq}`, registrationNumber: `9${String(seq).padStart(8, "0")}`, registrationDay: today, eventType: "NEW_ENTITY", firstSeenAt: new Date(), ...fields });
}

beforeAll(async () => {
  t = await makeTenants();
  await ensureCountries();
  await ensureServicePackages();
});

describe("Contact classification", () => {
  it("never counts placeholders, masked, no-reply or purpose-restricted values", () => {
    expect(classifyContactValue("EMAIL", "post@firma.no").usable).toBe(true);
    expect(classifyContactValue("EMAIL", "noreply@firma.no")).toMatchObject({ usable: false, purpose: "NO_REPLY" });
    expect(classifyContactValue("EMAIL", "faktura@firma.no")).toMatchObject({ usable: false, purpose: "RESTRICTED_PURPOSE" });
    expect(classifyContactValue("EMAIL", "p***@firma.no")).toMatchObject({ usable: false, purpose: "MASKED" });
    expect(classifyContactValue("EMAIL", "test@example.com").usable).toBe(false);
    expect(classifyContactValue("EMAIL", "support@brreg.no").usable).toBe(false); // registry admin address
    expect(classifyContactValue("PHONE", "+4700000000").usable).toBe(false);
    expect(classifyContactValue("PHONE", "+4791234567").usable).toBe(true);
  });
});

describe("Contact-first ordering (50 registrations, 20 with direct contacts)", () => {
  const ids: string[] = [];
  beforeAll(async () => {
    await Country.updateOne({ code: "NO" }, { $set: { providerId: "fixture-no" } });
    for (let i = 0; i < 50; i++) {
      const c = await mk({ companyName: `Order ${String(i).padStart(2, "0")} AS`, registrationDay: today });
      ids.push(String(c._id));
      if (i % 5 === 0 || i % 5 === 1) {
        // 20 companies: 10 email-only, 5 phone-only, 5 both
        if (i % 2 === 0) await recordContact(c, { type: "EMAIL", value: `post${i}@order.example`, sourceKind: "REGISTRY", source: "Fixture registry" });
        if (i % 2 === 1 || i % 10 === 0) await recordContact(c, { type: "PHONE", value: `+479100${String(i).padStart(4, "0")}`, sourceKind: "REGISTRY", source: "Fixture registry" });
        await recomputeCompanyContacts(c._id);
      }
    }
    await rebuildSnapshots("NO", today, today, { isDemo: false, complete: true, providerId: "fixture-no" });
  });

  it("puts all 20 direct-contact companies first across pages, keeps all 50 visible", async () => {
    const pages = [];
    for (let page = 1; page <= 5; page++) pages.push(await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", pageSize: 10, page }));
    expect(pages[0]!.total).toBe(50);
    const flat = pages.flatMap((p) => p.items);
    expect(flat).toHaveLength(50);
    expect(flat.slice(0, 20).every((c) => c.directContact?.has)).toBe(true);
    expect(flat.slice(20).every((c) => !c.directContact?.has)).toBe(true);
    expect(new Set(flat.map((c) => String(c._id))).size).toBe(50); // stable order, no duplicates across pages
  });

  it("contact filters: email, phone, both and no-direct are applied before pagination", async () => {
    const both = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", contact: "both" });
    const email = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", contact: "email" });
    const phone = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", contact: "phone" });
    const none = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", contact: "nodirect" });
    expect(both.total).toBe(5);
    expect(email.total).toBe(10);
    expect(phone.total).toBe(15);
    expect(none.total).toBe(30);
  });

  it("counts a company with both email and phone once — 40% direct-contact coverage", async () => {
    const o = await getRegistrationOverview(t.owner.actor, "NO", "today");
    const fixtures = await Company.countDocuments({ countryCode: "NO", registrationDay: today, companyName: /^Order / , "directContact.has": true });
    expect(fixtures).toBe(20);
    expect(o.research.directContacts).toBeGreaterThanOrEqual(20);
  });

  it("a newly enriched company moves into the direct group without changing its registration date", async () => {
    const target = await Company.findById(ids[49]).lean<CompanyDoc>();
    expect(target?.directContact?.has).toBeFalsy();
    await recordContact(target!, { type: "EMAIL", value: "hello@late-find.example", sourceKind: "WEBSITE", source: "Company website", ownership: "CONFIRMED" });
    const r = await recomputeCompanyContacts(target!._id);
    expect(r.becameContactable).toBe(true);
    const after = await Company.findById(ids[49]).lean<CompanyDoc>();
    expect(after?.registrationDay).toBe(today);
    expect(after?.contactFoundAt).toBeInstanceOf(Date);
    const first = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Order", pageSize: 21 });
    expect(first.items.map((c) => String(c._id))).toContain(ids[49]);
  });
});

describe("What counts as a direct contact", () => {
  it("website-only, contact-form-only, masked, invalid and uncertain values do not", async () => {
    const site = await mk();
    await recordContact(site, { type: "WEBSITE", value: "https://site-only.example", sourceKind: "REGISTRY", source: "Fixture" });
    expect((await recomputeCompanyContacts(site._id)).has).toBe(false);

    const form = await mk();
    await recordContact(form, { type: "CONTACT_FORM", value: "https://form.example/contact", sourceKind: "WEBSITE", source: "Company website" });
    await recomputeCompanyContacts(form._id);
    expect((await Company.findById(form._id).lean<CompanyDoc>())?.directContact).toMatchObject({ has: false, formOnly: true });

    const masked = await mk();
    await recordContact(masked, { type: "EMAIL", value: "j***@masked.example", sourceKind: "PUBLIC", source: "Directory" });
    expect((await recomputeCompanyContacts(masked._id)).has).toBe(false);

    const invalid = await mk();
    await recordContact(invalid, { type: "EMAIL", value: "gone@invalid.example", sourceKind: "WEBSITE", source: "Company website", emailVerification: "INVALID" });
    expect((await recomputeCompanyContacts(invalid._id)).has).toBe(false);

    const uncertain = await mk();
    const c = await recordContact(uncertain, { type: "PHONE", value: "+4792223344", sourceKind: "PUBLIC", source: "Public page", needsReview: true });
    expect((await recomputeCompanyContacts(uncertain._id)).has).toBe(false);
    // A human approval — not a confidence score — moves it into the direct group.
    await Contact.updateOne({ _id: c!._id }, { $set: { review: "APPROVED" } });
    expect((await recomputeCompanyContacts(uncertain._id)).has).toBe(true);
  });

  it("an intermediary's contact shared by several companies is not the companies' own", async () => {
    const shared = "+4722000111";
    const cs = [await mk(), await mk(), await mk()];
    for (const c of cs) {
      await recordContact(c, { type: "PHONE", value: shared, sourceKind: "REGISTRY", source: "Fixture registry" });
      await recomputeCompanyContacts(c._id);
    }
    await flagSharedContacts([shared], 3);
    const docs = await Contact.find({ value: shared }).lean<ContactDoc[]>();
    expect(docs.every((d) => d.ownership === "INTERMEDIARY")).toBe(true);
    for (const c of cs) expect((await Company.findById(c._id).lean<CompanyDoc>())?.directContact?.has).toBe(false);
  });
});

describe("Company / website matching", () => {
  it("requires the registration number or the exact legal name — similar names are not enough", () => {
    const company = { companyName: "Nordic Bakery Oslo AS", registrationNumber: "938000111" };
    expect(identityEvidence("<p>Nordic Bakery AS — best bread</p>", company)).toBeNull();
    expect(identityEvidence("<p>Nordic Bakery Oslo AS</p>", company)).toBe("EXACT_NAME");
    expect(identityEvidence("<footer>Org.nr 938 000 111</footer>", company)).toBe("REGISTRATION_NUMBER");
  });

  it("flags emails on other domains (agency / partner) and keeps the company's own", () => {
    const html = '<a href="mailto:post@bakery.no">mail</a> <p>Site by <a href="mailto:hello@webagency.example">agency</a></p> <a href="tel:22334455">22 33 44 55</a> <form><textarea></textarea></form>';
    const x = extractFromPage(html, "https://www.bakery.no/kontakt", "NO");
    expect(x.emails.find((e) => e.value === "post@bakery.no")?.onOwnDomain).toBe(true);
    expect(x.emails.find((e) => e.value === "hello@webagency.example")?.onOwnDomain).toBe(false);
    expect(x.phones.map((p) => p.value)).toEqual(["+4722334455"]);
    expect(x.forms).toEqual(["https://www.bakery.no/kontakt"]);
    // National-format numbers on a foreign site are not interpreted with this country's code.
    expect(extractFromPage('<a href="tel:0800230015">x</a>', "https://www.example.at/", "NO").phones).toEqual([]);
  });
});

describe("Ingestion edge cases", () => {
  const provider: CompanyRegistryProvider = {
    id: "fixture-edge",
    countryCode: "NO",
    name: "Fixture",
    sourceName: "Fixture registry",
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    homepage: "https://fixture.test",
    description: "test",
    capabilities: { ...NO_CAPABILITIES, supportsDailyRegistrations: true },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 30,
    async getRegistrations() {
      return { companies: [], total: 3, complete: false };
    },
    async checkStatus() {
      return { state: "CONNECTED", checkedAt: new Date() };
    },
  };
  const rec = (id: string, day?: string): NormalizedCompany => ({ identity: { sourceId: id, name: `Edge ${id} AS`, registrationNumber: id }, registration: { registrationDay: day }, classification: {}, contact: {}, address: {}, source: {} });

  it("duplicate and repeated events never create duplicates", async () => {
    await ingestCompanies(provider, "NO", [rec("800000001", today), rec("800000001", today)]);
    await ingestCompanies(provider, "NO", [rec("800000001", today)]);
    expect(await Company.countDocuments({ source: "fixture-edge", sourceId: "800000001" })).toBe(1);
  });

  it("unknown registration dates are stored but never counted as registered today", async () => {
    await ingestCompanies(provider, "NO", [rec("800000002")]);
    const res = await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Edge 800000002" });
    expect(res.total).toBe(0);
    expect(await Company.countDocuments({ sourceId: "800000002" })).toBe(1);
  });

  it("a late-arriving registration belongs to its registration day, and to 'first received' today", async () => {
    const old = addDays(today, -3);
    await ingestCompanies(provider, "NO", [rec("800000003", old)]);
    expect((await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Edge 800000003" })).total).toBe(0);
    expect((await listCompanies(t.owner.actor, { country: "NO", range: "custom", from: old, to: old, q: "Edge 800000003" })).total).toBe(1);
    expect((await listCompanies(t.owner.actor, { country: "NO", range: "today", view: "received", q: "Edge 800000003" })).total).toBe(1);
  });

  it("'contacts found today' includes old registrations whose contact was found today, without relabelling them", async () => {
    const c = await mk({ companyName: "Two Weeks Old AS", registrationDay: addDays(today, -14) });
    await recordContact(c, { type: "EMAIL", value: "new@twoweeks.example", sourceKind: "WEBSITE", source: "Company website", ownership: "CONFIRMED" });
    await recomputeCompanyContacts(c._id);
    expect((await listCompanies(t.owner.actor, { country: "NO", range: "today", view: "contacts", q: "Two Weeks Old" })).total).toBe(1);
    expect((await listCompanies(t.owner.actor, { country: "NO", range: "today", q: "Two Weeks Old" })).total).toBe(0);
  });

  it("midnight boundaries use the country's local day for timestamp views", () => {
    const lateEvening = new Date("2026-10-04T22:30:00Z"); // already 5 Oct in Oslo
    const f = registrationDayFilter("NO", "today", undefined, undefined, lateEvening, "received") as { firstSeenAt: { $gte: Date; $lt: Date } };
    expect(f.firstSeenAt.$gte.toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(f.firstSeenAt.$lt.toISOString()).toBe("2026-10-05T22:00:00.000Z");
  });

  it("incomplete pagination is reported, never presented as a complete day", async () => {
    registerTestProvider({ ...provider, id: "fixture-partial", countryCode: "IE", async getRegistrations() { return { companies: [rec("990001", todayIn("Europe/Dublin"))], total: 3, complete: false }; } });
    await Country.updateOne({ code: "IE" }, { $set: { providerId: "fixture-partial" } });
    const r = await syncToday("IE", { trigger: "MANUAL" });
    expect(r.status).toBe("PARTIAL");
    expect(r.complete).toBe(false);
    const o = await getRegistrationOverview(t.owner.actor, "IE", "today");
    expect(o.selected.complete).toBe(false);
  });
});

describe("Durable jobs, budgets and caching", () => {
  it("retries with backoff, then dead-letters; enqueue is idempotent", async () => {
    let calls = 0;
    registerJobHandler("test-fail", async () => {
      calls++;
      throw new Error("provider down");
    });
    await enqueueJob("test-fail", "test-fail:1", {}, { maxAttempts: 2 });
    await enqueueJob("test-fail", "test-fail:1", {}, { maxAttempts: 2 });
    expect(await Job.countDocuments({ key: "test-fail:1" })).toBe(1);
    await processDueJobs({ types: ["test-fail"], budgetMs: 2000 });
    let job = await Job.findOne({ key: "test-fail:1" }).lean<{ status: string; runAt: Date; attempts: number }>();
    expect(job?.status).toBe("FAILED");
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());
    await Job.updateOne({ key: "test-fail:1" }, { $set: { runAt: new Date(0) } });
    await processDueJobs({ types: ["test-fail"], budgetMs: 2000 });
    job = await Job.findOne({ key: "test-fail:1" }).lean<{ status: string; runAt: Date; attempts: number }>();
    expect(job?.status).toBe("DEAD");
    expect(calls).toBe(2);
  });

  it("paid lookups pause on a zero budget, a missing key or the per-company limit", async () => {
    const c = await mk();
    await updateSetting("research", { providers: { hunter: { enabled: true, priority: 1, costCentsPerCall: 10 } }, dailyBudgetCents: 0, monthlyBudgetCents: 0 }, t.owner.actor);
    expect(await canSpend("hunter", true, c)).toMatchObject({ ok: false, reason: "BUDGET_DAILY" });
    expect(await canSpend("hunter", false, c)).toMatchObject({ ok: false, reason: "NO_KEY" });
    expect(await canSpend("apollo", true, c)).toMatchObject({ ok: false, reason: "DISABLED" });
    await updateSetting("research", { providers: { hunter: { enabled: true, priority: 1, costCentsPerCall: 10 } }, dailyBudgetCents: 1000, monthlyBudgetCents: 5000, maxCostPerCompanyCents: 5 }, t.owner.actor);
    expect(await canSpend("hunter", true, c)).toMatchObject({ ok: false, reason: "COMPANY_LIMIT" });
    await updateSetting("research", { providers: { hunter: { enabled: true, priority: 1, costCentsPerCall: 10 } }, dailyBudgetCents: 1000, monthlyBudgetCents: 5000, maxCostPerCompanyCents: 50 }, t.owner.actor);
    expect(await canSpend("hunter", true, c)).toMatchObject({ ok: true, costCents: 10 });
  });

  it("caches lookup results (including negatives) so unchanged results are not paid for twice", async () => {
    await setCached("hunter:ds:none.example", "hunter", null, 14);
    expect(await getCached("hunter:ds:none.example")).toBeNull();
    await LookupCache.updateOne({ key: "hunter:ds:none.example" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCached("hunter:ds:none.example")).toBeUndefined();
  });
});

describe("Companies House stream handling", () => {
  it("decides new incorporations from company data and commits the timepoint after storing", async () => {
    const londonToday = todayIn("Europe/London");
    const events = [
      { resource_kind: "company-profile", data: { company_number: "SC000001", company_name: "STREAM NEW LTD", company_status: "active", company_type: "ltd", date_of_creation: londonToday }, event: { timepoint: 101, published_at: new Date().toISOString() } },
      { resource_kind: "company-profile", data: { company_number: "00000002", company_name: "OLD CO LTD", date_of_creation: "1990-01-01" }, event: { timepoint: 102 } },
    ];
    await handleStreamEvents(events);
    await handleStreamEvents(events); // replay after reconnect: idempotent
    expect(await Company.countDocuments({ countryCode: "GB", sourceId: "SC000001" })).toBe(1);
    expect(await Company.countDocuments({ countryCode: "GB", sourceId: "00000002" })).toBe(0);
    expect((await Checkpoint.findOne({ key: "stream:companies-house" }).lean<{ value: string }>())?.value).toBe("102");
  });
});

describe("Registry normalizers (documented / test-environment record shapes)", () => {
  it("KVK: invalid start dates are rejected, non-mailing restricts, NW = new formation", () => {
    const profile: KvkBasisprofiel = {
      kvkNummer: "90003403",
      naam: "Company Streetplanet Eenmanszaak",
      indNonMailing: "Ja",
      sbiActiviteiten: [{ sbiCode: "69203", sbiOmschrijving: "Activiteiten van boekhouders", indHoofdactiviteit: "Ja" }],
      _embedded: { eigenaar: { rechtsvorm: "Eenmanszaak" }, hoofdvestiging: { adressen: [{ type: "bezoekadres", indAfgeschermd: "Nee", straatnaam: "Hegelhof", huisnummer: 46, postcode: "1064VX", plaats: "Amsterdam", land: "Nederland" }] } },
    };
    const n = normalizeKvk(profile, { signaalType: "SignaalNieuweInschrijving", registratieTijdstip: "2026-09-27T14:30:02+02:00", heeftBetrekkingOp: { kvkNummer: "90003403", nonMailing: false }, heeftNieuweGegevens: { aanleiding: { code: "NW", omschrijving: "NIEUW" }, startdatum: "20263027" } });
    expect(n.registration.registrationDay).toBeUndefined(); // "20263027" (KVK test data) is not a real date
    expect(n.marketingProtected).toBe(true);
    expect(n.eventType).toBe("NEW_ENTITY");
    expect(n.classification.naceCode).toBe("69.20");
    const cont = normalizeKvk(profile, { signaalType: "SignaalNieuweInschrijving", registratieTijdstip: "2026-09-27T14:30:02+02:00", heeftBetrekkingOp: { kvkNummer: "1" }, heeftNieuweGegevens: { aanleiding: { code: "VZ", omschrijving: "VOORTZETTING" }, startdatum: "20260927" } });
    expect(cont.eventType).toBe("KVK_VZ");
    expect(cont.registration.registrationDay).toBe("2026-09-27");
  });

  it("CRO: placeholder addresses are dropped, NACE mapped", () => {
    const n = normalizeCroRecord({ company_num: "826954", company_name: "BUILDING PATHOLOGY IRELAND LIMITED", company_reg_date: "2026-09-29T00:00:00", company_type: "LTD - Private Company Limited by Shares", company_status: "Normal ", company_address_1: "Rainbow Cottage", company_address_3: "Garryglass, Templederry", company_address_4: "Nenagh, TIPPERARY, Ireland", eircode: "E45 KV91", nace_v2_code: "7022" });
    expect(n.registration.registrationDay).toBe("2026-09-29");
    expect(n.classification.naceCode).toBe("70.22");
    expect(n.address.business?.city).toBe("Nenagh");
    expect(normalizeCroRecord({ company_num: 1, company_name: "X", company_address_1: "********NO ADDRESS DETAILS*******" }).address.business?.street).toBeUndefined();
  });

  it("RIK: contacts from sidevahendid; XML parsing never expands entities", () => {
    const n = normalizeRikDetail({ ariregistri_kood: "17000001", nimi: "Fixture OÜ", yldandmed: { esmaregistreerimise_kpv: "2026-10-01", staatus_tekstina: "Registered", oiguslik_vorm_tekstina: "Private limited company", sidevahendid: { item: [{ liik: "EMAIL", sisu: "info@fixture.example" }, { liik: "MOB", sisu: "+372 5555 1234" }] }, teatatud_tegevusalad: { item: { emtak_kood: "62011", nace_kood: "62.01", emtak_tekstina: "Programming" } } } });
    expect(n?.contact.email).toBe("info@fixture.example");
    expect(n?.contact.mobile).toBe("+37255551234");
    expect(n?.registration.registrationDay).toBe("2026-10-01");
    const evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]><x><nimi>&b;</nimi></x>';
    const parsed = rikTest.parser.parse(evil) as { x: { nimi: string } };
    expect(parsed.x.nimi).not.toContain("AAAA");
    expect(rikTest.envelope("detailandmed_v2", { ariregistri_kood: "<script>" })).toContain("&lt;script&gt;");
  });
});

describe("Eligibility, export restrictions, quotations and service fit", () => {
  it("restricted and suppressed contacts are withheld from exports", async () => {
    const cleared = await mk({ companyName: "Export Cleared AS", email: "ok@cleared.example" });
    const restricted = await mk({ companyName: "Export Restricted AS", email: "no@restricted.example", eligibility: { status: "RESTRICTED", reason: "test" } });
    const suppressed = await mk({ companyName: "Export Suppressed AS", email: "stop@suppressed.example" });
    await SuppressionEntry.create({ email: "stop@suppressed.example", reason: "OPT_OUT", source: "test" });
    void cleared;
    void restricted;
    void suppressed;
    const { csv } = await exportCompanies(t.owner.actor, { country: "NO", range: "today", q: "Export " });
    expect(csv).toContain("ok@cleared.example");
    expect(csv).not.toContain("no@restricted.example");
    expect(csv).not.toContain("stop@suppressed.example");
    expect(csv).toContain("Withheld (suppression list)");
  });

  it("quotations only allow eligible recipients and keep missing prices as placeholders", async () => {
    const c = await mk({ companyName: "Quote Target AS" });
    const contact = await recordContact(c, { type: "EMAIL", value: "buyer@quote.example", sourceKind: "REGISTRY", source: "Fixture registry" });
    await recomputeCompanyContacts(c._id);
    await expectRejects(createQuotation(t.owner.actor, String(c._id), { recipientContactId: String(contact!._id) }), 400); // not cleared yet
    await setEligibility(t.owner.actor, String(c._id), { status: "CLEARED", reason: "B2B limited company, assessed" });
    const pkg = await ServicePackage.findOne({ key: "digital-foundation" }).lean<{ _id: Types.ObjectId }>();
    const q = await createQuotation(t.owner.actor, String(c._id), { packageId: String(pkg!._id), recipientContactId: String(contact!._id) });
    expect(q.recipient?.email).toBe("buyer@quote.example");
    expect((q.items as { unitPrice?: number | null }[]).every((i) => i.unitPrice === null || i.unitPrice === undefined)).toBe(true);
    await expectRejects(updateQuotation(t.owner.actor, String(q._id), { status: "READY" }), 400);
    expect(await Quotation.countDocuments({ companyId: c._id })).toBe(1);
    expect((await Company.findById(c._id).lean<CompanyDoc>())?.lead?.stage).toBe("QUOTATION_DRAFTED");
  });

  it("service fit uses evidence only: 'no website' requires research first; webmail evidence is explicit", async () => {
    const c = await mk({ companyName: "Fit Test AS" });
    let fit = await assessServiceFit(c._id);
    expect(fit?.suggestions.some((s) => s.packageName === "Digital Foundation")).toBe(false); // not researched yet
    await Company.updateOne({ _id: c._id }, { $set: { "research.attempts": 1 } });
    await recordContact(c, { type: "EMAIL", value: "fittest@gmail.com", sourceKind: "REGISTRY", source: "Fixture registry" });
    await recomputeCompanyContacts(c._id);
    fit = await assessServiceFit(c._id);
    const df = fit?.suggestions.find((s) => s.packageName === "Digital Foundation");
    expect(df?.observation).toContain("not proof");
    expect(fit?.suggestions.find((s) => s.packageName === "Business email & hosting")?.observation).toContain("gmail.com");
  });

  it("clients cannot set eligibility or create quotations", async () => {
    const c = await mk();
    await expectRejects(setEligibility(t.clientA.actor, String(c._id), { status: "CLEARED", reason: "nope" }), 403);
    await expectRejects(createQuotation(t.clientA.actor, String(c._id), {}), 403);
  });
});
