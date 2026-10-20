import { beforeAll, describe, expect, it } from "vitest";
import { Company, Contact, Country, CrmActivity, DailyRegistrationSnapshot, RegistrySync, SuppressionEntry, type CompanyDoc, type CountryDoc } from "@/models";
import { addDays, resolveDayRange, todayIn, type Day } from "@/lib/dates/country-time";
import { contactQuality } from "@/lib/company-fields";
import { ensureCountries, getCountryView } from "@/features/countries/service";
import { getRegistryProvider, registerTestProvider } from "@/features/registry/providers";
import { syncDate, syncToday } from "@/features/registry/sync";
import { NO_CAPABILITIES, type CompanyRegistryProvider, type NormalizedCompany } from "@/features/registry/types";
import { listCompanies, qualifyCompany, rescoreCompanies, updateCompany } from "@/features/companies/service";
import { getRegistrationOverview } from "@/features/companies/registrations";
import { assignLead, changeStage, createFollowUp, listFollowUps } from "@/features/crm/service";
import { normalizeBrregEnhet, normalizeBrregRoller, type BrregEnhet } from "@/features/registry/providers/brreg";
import { expectRejects, makeTenants } from "./helpers";

/**
 * In-memory registry used only by tests (registerTestProvider refuses to run
 * outside the test runner). Records mirror what a real provider normalizes.
 */
type Fixture = Map<Day, NormalizedCompany[]>;
function company(id: string, name: string, day: Day, contact: NormalizedCompany["contact"] = {}): NormalizedCompany {
  return {
    identity: { sourceId: id, name, registrationNumber: id },
    registration: { registrationDay: day, status: "Active", legalForm: "Aksjeselskap", legalFormCode: "AS" },
    classification: { industryCode: "62.010", industryDescription: "Programmeringstjenester", naceCode: "62.01" },
    contact,
    address: { business: { street: "Testveien 1", postalCode: "0150", city: "Oslo" } },
    source: { url: `https://virksomhet.brreg.no/nb/oppslag/enheter/${id}` },
  };
}

function testProvider(id: string, countryCode: string, data: Fixture, opts: { fail?: () => boolean } = {}): CompanyRegistryProvider {
  return {
    id,
    countryCode,
    name: `Test ${countryCode}`,
    sourceName: `Test registry ${countryCode}`,
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "REAL_TIME",
    isDemo: false,
    homepage: "https://registry.test",
    description: "Test provider",
    capabilities: { ...NO_CAPABILITIES, supportsDailyRegistrations: true, supportsRegistrationDate: true, supportsEmail: true, supportsPhone: true, supportsWebsite: true },
    requiredEnv: [],
    isConfigured: () => true,
    recommendedSyncMinutes: 30,
    async getRegistrations(from, to) {
      if (opts.fail?.()) throw new Error("Registry responded 503");
      const out: NormalizedCompany[] = [];
      for (const [day, list] of data) if (day >= from && day <= to) out.push(...list);
      return { companies: out, total: out.length, complete: true };
    },
    async checkStatus() {
      return { state: "CONNECTED", checkedAt: new Date() };
    },
  };
}

let t: Awaited<ReturnType<typeof makeTenants>>;
const noToday = todayIn("Europe/Oslo");
const noYesterday = addDays(noToday, -1);
const seToday = todayIn("Europe/Stockholm");
let failNorway = false;

const norway: Fixture = new Map([
  [
    noToday,
    [
      company("900000001", "Fjord Digital AS", noToday, { email: "post@fjord-digital.example", phone: "+4722334455", website: "https://fjord-digital.example" }),
      company("900000002", "Kaffebar Oslo AS", noToday, { mobile: "+4791234567" }),
      company("900000003", "Tom Holding AS", noToday),
    ],
  ],
  [noYesterday, [company("900000004", "Gårsdagens AS", noYesterday, { email: "hei@gars.example" })]],
]);
const sweden: Fixture = new Map([[seToday, [company("5590000001", "Stockholm Studio AB", seToday, { email: "hej@studio.example" })]]]);

beforeAll(async () => {
  t = await makeTenants();
  registerTestProvider(testProvider("test-no", "NO", norway, { fail: () => failNorway }));
  registerTestProvider(testProvider("test-se", "SE", sweden));
  await ensureCountries();
  await Country.updateOne({ code: "NO" }, { $set: { providerId: "test-no" } });
  await Country.updateOne({ code: "SE" }, { $set: { providerId: "test-se" } });
  await syncDate("NO", noYesterday, { trigger: "MANUAL", notify: false });
  await syncToday("NO", { trigger: "MANUAL", notify: false });
  await syncToday("SE", { trigger: "MANUAL", notify: false });
});

describe("Country-local dates", () => {
  it("uses each country's timezone for 'today'", () => {
    const lateEvening = new Date("2026-10-04T22:30:00Z"); // 00:30 in Oslo, 23:30 in London
    expect(todayIn("Europe/Oslo", lateEvening)).toBe("2026-10-05");
    expect(todayIn("Europe/London", lateEvening)).toBe("2026-10-04");
    expect(resolveDayRange("Europe/Oslo", undefined, undefined, undefined, lateEvening)).toMatchObject({ preset: "today", from: "2026-10-05", to: "2026-10-05" });
    expect(resolveDayRange("Europe/Oslo", "yesterday", undefined, undefined, lateEvening)).toMatchObject({ from: "2026-10-04", to: "2026-10-04" });
    expect(resolveDayRange("Europe/Oslo", "7d", undefined, undefined, lateEvening)).toMatchObject({ from: "2026-09-29", to: "2026-10-05" });
  });
});

describe("Registry sync", () => {
  it("imports, normalizes and records source + freshness on every company", async () => {
    const no = await Company.find({ countryCode: "NO" }).lean<CompanyDoc[]>();
    expect(no).toHaveLength(4);
    for (const c of no) {
      expect(c.source).toBe("test-no");
      expect(c.sourceName).toBe("Test registry NO");
      expect(c.dataFreshness).toBe("REAL_TIME");
      expect(c.sourceFetchedAt).toBeInstanceOf(Date);
      expect(c.countryName).toBe("Norway");
      expect(c.isDemo).toBe(false);
    }
    const fjord = no.find((c) => c.companyName === "Fjord Digital AS")!;
    expect(fjord.email).toBe("post@fjord-digital.example");
    expect(fjord.contactSources?.email?.kind).toBe("REGISTRY");
    expect(fjord.fullyContactable).toBe(true);
    expect(await Contact.countDocuments({ companyId: fjord._id, sourceKind: "REGISTRY" })).toBe(3);
  });

  it("re-syncing the same day skips unchanged records instead of duplicating", async () => {
    const r = await syncToday("NO", { trigger: "MANUAL", notify: false });
    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(3);
    expect(await Company.countDocuments({ countryCode: "NO" })).toBe(4);
    expect(await RegistrySync.countDocuments({ countryCode: "NO", status: "SUCCESS" })).toBe(3);
  });

  it("writes daily snapshots keyed by the registry date", async () => {
    const snap = await DailyRegistrationSnapshot.findOne({ countryCode: "NO", date: noToday }).lean<{ newCompanies: number; withEmail: number; withPhone: number; fullyContactable: number }>();
    expect(snap).toMatchObject({ newCompanies: 3, withEmail: 1, withPhone: 2, fullyContactable: 1 });
  });

  it("a failing registry is reported as unavailable — stored data is kept and nothing is substituted", async () => {
    failNorway = true;
    const before = await Company.countDocuments({ countryCode: "NO" });
    const r = await syncToday("NO", { trigger: "MANUAL", notify: false });
    failNorway = false;
    expect(r.status).toBe("FAILED");
    expect(r.errors[0]).toContain("503");
    expect(await Company.countDocuments({ countryCode: "NO" })).toBe(before);
    expect((await getCountryView("NO"))?.state).toBe("PROVIDER_ERROR");
    await syncToday("NO", { trigger: "MANUAL", notify: false });
    expect((await getCountryView("NO"))?.state).toBe("CONNECTED");
  });

  it("countries without a connected feed refuse to sync and show no counts", async () => {
    // Distinct, honest states — a country in the list is not an integration.
    expect((await getCountryView("GB"))?.state).toBe("NEEDS_CREDENTIALS");
    expect((await getCountryView("DE"))?.state).toBe("NEEDS_CREDENTIALS");
    // The contract-based Estonian adapter still needs an agreement (selectable, not the default).
    expect(getRegistryProvider("rik")).toMatchObject({ accessType: "AGREEMENT" });
    expect(getRegistryProvider("rik")?.isConfigured()).toBe(false);
    // Estonia now defaults to the credential-free open-data file: a live source, never "Connected" before a real sync.
    expect((await getCountryView("EE"))?.state).toBe("NOT_SYNCED");
    expect((await getCountryView("AT"))?.state).toBe("UNDER_RESEARCH");
    expect((await getCountryView("VA"))?.state).toBe("NO_VERIFIED_FEED");
    await expectRejects(syncToday("GB", { trigger: "MANUAL", notify: false }), 400);
    await expectRejects(syncToday("DE", { trigger: "MANUAL", notify: false }), 400);
    expect(await Company.countDocuments({ countryCode: { $in: ["DE", "GB", "EE", "AT"] } })).toBe(0);
  });

  it("demo providers are unavailable unless demo mode is enabled", () => {
    expect(process.env.DEMO_MODE).not.toBe("true");
    expect(getRegistryProvider("mock-no")).toBeUndefined();
    expect(getRegistryProvider("brreg")?.isDemo).toBe(false);
  });
});

describe("Today view (registration date, not import date)", () => {
  it("Norway + Today returns only companies whose registry date is today in Oslo", async () => {
    // Imported right now, but registered yesterday — must NOT appear in today's list.
    await Company.create({ companyName: "Imported Now AS", countryCode: "NO", source: "manual-test", sourceId: "x1", registrationDay: noYesterday });
    const res = await listCompanies(t.owner.actor, { country: "NO", range: "today", pageSize: 100 });
    expect(res.items.map((c) => c.companyName).sort()).toEqual(["Fjord Digital AS", "Kaffebar Oslo AS", "Tom Holding AS"]);
    expect(res.items.every((c) => c.registrationDay === noToday && c.countryCode === "NO")).toBe(true);
  });

  it("the overview shows today's count first, from the registry snapshot", async () => {
    const o = await getRegistrationOverview(t.owner.actor, "NO", "today");
    expect(o.quick.today).toBe(3);
    expect(o.selected).toMatchObject({ known: true, total: 3, withEmail: 1, fullyContactable: 1 });
    expect(o.timeline[0]).toEqual({ date: noToday, count: 3 });
  });

  it("contact availability filters and completeness sorting work server-side", async () => {
    const withEmail = await listCompanies(t.owner.actor, { country: "NO", range: "today", contact: "email" });
    expect(withEmail.items.map((c) => c.companyName)).toEqual(["Fjord Digital AS"]);
    const withPhone = await listCompanies(t.owner.actor, { country: "NO", range: "today", contact: "phone" });
    expect(withPhone.items.map((c) => c.companyName).sort()).toEqual(["Fjord Digital AS", "Kaffebar Oslo AS"]);
    const none = await listCompanies(t.owner.actor, { country: "NO", range: "today", contact: "none" });
    expect(none.items.map((c) => c.companyName)).toEqual(["Tom Holding AS"]);
    const sorted = await listCompanies(t.owner.actor, { country: "NO", range: "today", sort: "completeness" });
    expect(sorted.items[0]!.companyName).toBe("Fjord Digital AS");
  });
});

describe("Country filtering", () => {
  it("Norway filtering never returns another country's companies", async () => {
    const res = await listCompanies(t.owner.actor, { country: "NO", range: "all", pageSize: 100 });
    expect(res.total).toBeGreaterThan(0);
    expect(new Set(res.items.map((c) => c.countryCode))).toEqual(new Set(["NO"]));
  });

  it("search terms cannot widen the country scope", async () => {
    const res = await listCompanies(t.owner.actor, { country: "SE", range: "all", q: ".*" });
    expect(res.items.every((c) => c.countryCode === "SE")).toBe(true);
  });

  it("mixed views require an explicit ALL, each country on its own local date", async () => {
    const all = await listCompanies(t.owner.actor, { country: "ALL", range: "today", pageSize: 100 });
    expect(new Set(all.items.map((c) => c.countryCode))).toEqual(new Set(["NO", "SE"]));
    await expectRejects(listCompanies(t.owner.actor, { country: "XX" }), 400);
    await expectRejects(listCompanies(t.owner.actor, {}), 400);
  });

  it("clients can never access company intelligence", async () => {
    await expectRejects(listCompanies(t.clientA.actor, { country: "NO" }), 403);
    await expectRejects(getRegistrationOverview(t.clientA.actor, "NO", "today"), 403);
    const c = await Company.findOne({ countryCode: "NO" }).lean<CompanyDoc>();
    await expectRejects(qualifyCompany(t.clientA.actor, String(c!._id), { relevance: "RELEVANT" }), 403);
  });
});

describe("Contact provenance", () => {
  it("manual values are never overwritten by registry syncs", async () => {
    const tom = await Company.findOne({ countryCode: "NO", companyName: "Tom Holding AS" }).lean<CompanyDoc>();
    await updateCompany(t.owner.actor, String(tom!._id), { email: "daglig.leder@tom.example" });
    norway.get(noToday)![2] = company("900000003", "Tom Holding AS", noToday, { email: "registry@tom.example" });
    await syncToday("NO", { trigger: "MANUAL", notify: false });
    const after = await Company.findById(tom!._id).lean<CompanyDoc>();
    expect(after?.email).toBe("daglig.leder@tom.example");
    expect(after?.contactSources?.email?.kind).toBe("MANUAL");
    // The registry value is still recorded, attributed to the registry.
    expect(await Contact.exists({ companyId: tom!._id, value: "registry@tom.example", sourceKind: "REGISTRY" })).toBeTruthy();
  });

  it("registry-sourced values disappear when the registry removes them", async () => {
    norway.get(noToday)![1] = company("900000002", "Kaffebar Oslo AS", noToday, {});
    await syncToday("NO", { trigger: "MANUAL", notify: false });
    const k = await Company.findOne({ countryCode: "NO", companyName: "Kaffebar Oslo AS" }).lean<CompanyDoc>();
    expect(k?.mobile).toBeUndefined();
    expect(k?.contactFlags?.mobile).toBe(false);
  });

  it("completeness weights reachable channels", () => {
    expect(contactQuality({ email: "a@b.c", phone: "+47", website: "https://x" })).toMatchObject({ completeness: 75, fullyContactable: true });
    expect(contactQuality({})).toMatchObject({ completeness: 0, fullyContactable: false });
  });
});

describe("Brønnøysund normalization (real API record shape)", () => {
  const record: BrregEnhet = {
    organisasjonsnummer: "938000000",
    navn: "AL-QARI",
    organisasjonsform: { kode: "FLI", beskrivelse: "Forening/lag/innretning" },
    registreringsdatoEnhetsregisteret: "2026-10-02",
    stiftelsesdato: "2026-09-15",
    naeringskode1: { kode: "94.910", beskrivelse: "Religiøse organisasjoner" },
    postadresse: { adresse: ["Utmarkveien 27"], postnummer: "0689", poststed: "OSLO", kommune: "OSLO" },
    epostadresse: "info@alqari.no",
    mobil: "+4748011112",
    hjemmeside: "www.alqari.no",
    aktivitet: ["Religiøs virksomhet."],
    vedtektsfestetFormaal: ["Formålet er å drive", "religiøs virksomhet."],
    konkurs: false,
    underAvvikling: false,
  };

  it("maps contact fields to real values, never placeholders", () => {
    const n = normalizeBrregEnhet(record);
    expect(n.contact).toEqual({ email: "info@alqari.no", phone: undefined, mobile: "+4748011112", website: "https://www.alqari.no" });
    expect(n.registration).toMatchObject({ registrationDay: "2026-10-02", incorporationDay: "2026-09-15", status: "Active", legalFormCode: "FLI" });
    expect(n.classification.purpose).toBe("Formålet er å drive religiøs virksomhet.");
    expect(n.address.postal).toMatchObject({ street: "Utmarkveien 27", postalCode: "0689", city: "Oslo" });
    expect(n.source.url).toBe("https://virksomhet.brreg.no/nb/oppslag/enheter/938000000");
  });

  it("treats 'Uoppgitt' industry as missing and picks the managing director as contact person", () => {
    expect(normalizeBrregEnhet({ ...record, naeringskode1: { kode: "00.000", beskrivelse: "Uoppgitt" } }).classification.industryCode).toBeUndefined();
    const roles = normalizeBrregRoller({
      rollegrupper: [
        { type: { kode: "STYR", beskrivelse: "Styre" }, roller: [{ type: { kode: "LEDE", beskrivelse: "Styrets leder" }, person: { navn: { fornavn: "Asbjørn", etternavn: "Dahlberg" } } }] },
        { type: { kode: "DAGL", beskrivelse: "Daglig leder" }, roller: [{ type: { kode: "DAGL", beskrivelse: "Daglig leder" }, person: { navn: { fornavn: "Kari", etternavn: "Nordmann" } } }] },
        { type: { kode: "REVI", beskrivelse: "Revisor" }, roller: [{ type: { kode: "REVI", beskrivelse: "Revisor" }, enhet: { navn: ["REVISJON AS"] } }, { type: { kode: "REVI" }, fratraadt: true, enhet: { navn: ["OLD AS"] } }] },
      ],
    });
    expect(roles.contactPerson).toMatchObject({ name: "Kari Nordmann", role: "Daglig leder" });
    expect(roles.people.map((p) => p.name)).toEqual(["Asbjørn Dahlberg", "Kari Nordmann", "REVISJON AS"]);
  });
});

describe("Qualification & CRM", () => {
  it("records relevance and saved leads, filterable on the daily list", async () => {
    const c = await Company.findOne({ countryCode: "NO", companyName: "Fjord Digital AS" }).lean<CompanyDoc>();
    await qualifyCompany(t.owner.actor, String(c!._id), { relevance: "RELEVANT", saved: true });
    const relevant = await listCompanies(t.owner.actor, { country: "NO", range: "today", relevance: "RELEVANT" });
    expect(relevant.items.map((x) => x.companyName)).toEqual(["Fjord Digital AS"]);
    const saved = await listCompanies(t.owner.actor, { country: "NO", range: "all", saved: "yes" });
    expect(saved.total).toBe(1);
  });

  it("stage changes are logged; Do Not Contact suppresses the email", async () => {
    const c = await Company.findOne({ countryCode: "NO", email: { $exists: true } }).lean<CompanyDoc>();
    await changeStage(t.owner.actor, String(c!._id), { stage: "DO_NOT_CONTACT", note: "Asked not to be contacted" });
    const updated = await Company.findById(c!._id).lean<CompanyDoc>();
    expect(updated?.lead?.stage).toBe("DO_NOT_CONTACT");
    expect(await CrmActivity.countDocuments({ companyId: c!._id, type: "STAGE_CHANGE" })).toBe(1);
    expect(await SuppressionEntry.exists({ email: c!.email })).toBeTruthy();
  });

  it("CRM is owner-only: ADMIN and STAFF (staff workspace) cannot read or change leads", async () => {
    const c = await Company.findOne({ countryCode: "SE" }).lean<CompanyDoc>();
    for (const u of [t.staff, t.admin]) {
      await expectRejects(changeStage(u.actor, String(c!._id), { stage: "RESEARCHING" }), 403);
      await expectRejects(assignLead(u.actor, String(c!._id), { userId: u.actor.id }), 403);
      await expectRejects(listCompanies(u.actor, { country: "SE", range: "all" }), 403);
    }
    await changeStage(t.owner.actor, String(c!._id), { stage: "RESEARCHING" });
    const fu = await createFollowUp(t.owner.actor, String(c!._id), { dueAt: new Date(Date.now() - 86_400_000).toISOString(), type: "CALL" });
    expect(String(fu.assignedTo)).toBe(t.owner.actor.id);
    const overdue = (await listFollowUps(t.owner.actor, { country: "SE", bucket: "overdue" })) as unknown as { _id: unknown }[];
    expect(overdue.some((f) => String(f._id) === String(fu._id))).toBe(true);
    const noCountry = (await listFollowUps(t.owner.actor, { country: "NO", bucket: "overdue" })) as unknown[];
    expect(noCountry).toHaveLength(0);
  });

  it("scoring never changes the pipeline stage (qualification is a human decision)", async () => {
    await Company.updateMany({ countryCode: "NO", "lead.stage": { $ne: "DO_NOT_CONTACT" } }, { $set: { "lead.stage": "NEW" } });
    await rescoreCompanies({ countryCode: "NO" });
    expect(await Company.countDocuments({ countryCode: "NO", "lead.stage": "QUALIFIED" })).toBe(0);
    const country = await Country.findOne({ code: "NO" }).lean<CountryDoc>();
    expect(country?.lastSyncStatus).toBe("SUCCESS");
  });
});
