import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Company, DailyRegistrationSnapshot, type CompanyDoc } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { JURISDICTIONS, getJurisdiction } from "@/config/jurisdictions";
import { compareCountries, CONTINENT_ORDER, countryStatus, coverageTier, sortCountries, type CountryRankInput } from "@/lib/integration-state";
import { ensureCountries, listCountries } from "@/features/countries/service";
import { getRegistryProvider } from "@/features/registry/providers";
import { syncDate } from "@/features/registry/sync";
import { clearBulkCache } from "@/features/registry/bulk-file";
import { krsDay, normalizeKrsExtract, scanKrsDay, type KrsExtract } from "@/features/registry/providers/krs-pl";
import { normalizeUsRow, US_FEEDS } from "@/features/registry/providers/us-socrata";
import { normalizeCbcaRow, parseCbcaFile } from "@/features/registry/providers/corporations-canada";
import { asicDate, asicDay, normalizeAsicRecord } from "@/features/registry/providers/asic-au";
import { normalizeNtaRecord, parseNtaXml } from "@/features/registry/providers/nta-jp";
import { expectRejects } from "./helpers";

/**
 * Company Intelligence coverage beyond Europe: tiered ordering, honest states for unsupported
 * countries, and the new official-source adapters. All HTTP responses are FIXTURES shaped like
 * the real responses verified on 26–27 Oct 2026 — no live calls, no production data.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  clearBulkCache();
});

beforeAll(async () => {
  await ensureCountries();
});

describe("11. Coverage ordering: same-day first, Europe first inside each tier", () => {
  const cov = (total: number, withDirect = 0) => ({ days: 30, total, withEmail: withDirect, withPhone: 0, withWebsite: 0, withPerson: 0, withDirect });
  const now = new Date();
  const live = (name: string, timeliness: CountryRankInput["timeliness"], continent: CountryRankInput["continent"], total = 50, direct = 0): CountryRankInput => ({ name, state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(total, direct), timeliness, continent });
  const list: CountryRankInput[] = [
    live("United States", "NEXT_DAY", "NORTH_AMERICA", 5000, 900),
    { name: "South Korea", state: "NO_VERIFIED_FEED", adapterReady: false, timeliness: "UNKNOWN", continent: "ASIA" },
    live("Finland", "NEXT_DAY", "EUROPE"),
    { name: "Japan", state: "NEEDS_CREDENTIALS", adapterReady: true, timeliness: "NEXT_DAY", continent: "ASIA" },
    live("Poland", "SAME_DAY", "EUROPE", 900),
    { name: "United Kingdom", state: "NEEDS_CREDENTIALS", adapterReady: true, timeliness: "SAME_DAY", continent: "EUROPE" },
    live("Norway", "SAME_DAY", "EUROPE", 400, 60),
    { name: "Austria", state: "UNDER_RESEARCH", adapterReady: false, timeliness: "UNKNOWN", continent: "EUROPE" },
  ];

  it("puts verified same-day feeds first, then delayed feeds, then partial / unavailable", () => {
    const sorted = sortCountries(list).map((c) => c.name);
    expect(sorted.slice(0, 2)).toEqual(["Norway", "Poland"]); // tier 1, Europe, contact coverage first
    expect(sorted.slice(2, 4)).toEqual(["Finland", "United States"]); // tier 2: Europe before other regions even with more data
    expect(sorted.slice(4)).toEqual(["United Kingdom", "Austria", "Japan", "South Korea"]); // tier 3: Europe first
    expect(list.map((c) => coverageTier(c))).toEqual([2, 3, 2, 3, 1, 3, 1, 3]);
  });

  it("a same-day source is only tier 1 once it has delivered data, and a failing one drops to tier 3", () => {
    expect(coverageTier({ name: "PL", state: "NOT_SYNCED", adapterReady: true, timeliness: "SAME_DAY" })).toBe(2);
    expect(coverageTier({ name: "PL", state: "PROVIDER_ERROR", adapterReady: true, timeliness: "SAME_DAY" })).toBe(3);
    expect(compareCountries(live("A", "SAME_DAY", "ASIA"), live("B", "NEXT_DAY", "EUROPE"))).toBeLessThan(0);
  });

  it("the catalogue gives every jurisdiction a region and an honest update window", () => {
    for (const j of JURISDICTIONS) {
      expect(CONTINENT_ORDER).toContain(j.continent);
      expect(j.updateWindow.length).toBeGreaterThan(3);
    }
    for (const code of ["US", "CA", "JP", "KR", "SG", "HK", "TW", "IN", "AE", "SA", "QA", "AU", "NZ", "PL", "GB", "DE", "FR", "NL", "IE", "BE", "CH", "SE", "NO", "DK", "FI", "AT", "IT", "ES", "LU"]) expect(getJurisdiction(code), code).toBeTruthy();
    expect(getJurisdiction("NO")!.timeliness).toBe("SAME_DAY");
    expect(getJurisdiction("PL")!.timeliness).toBe("SAME_DAY");
    expect(getJurisdiction("FR")!.timeliness).toBe("DELAYED");
    // Every CONNECTED jurisdiction has a real adapter with a daily feed.
    for (const j of JURISDICTIONS.filter((x) => x.state === "CONNECTED")) {
      const p = getRegistryProvider(j.providers[0]);
      expect(p?.capabilities.supportsDailyRegistrations, j.code).toBe(true);
      expect(p?.countryCode).toBe(j.code);
    }
  });
});

describe("12. No fabricated data for unsupported countries; metadata for supported ones", () => {
  it("unsupported countries have no feed, can't be synced and report no data", async () => {
    const views = await listCountries();
    for (const code of ["KR", "HK", "AE", "SA", "QA"]) {
      const v = views.find((x) => x.code === code)!;
      expect(v.state).toBe("NO_VERIFIED_FEED");
      expect(v.dailyFeed).toBe(false);
      expect(countryStatus({ name: v.name, state: v.state, adapterReady: false })).toBe("NA");
      await expectRejects(syncDate(code, todayIn(v.timezone), { trigger: "MANUAL" }), 400);
      expect(await Company.countDocuments({ countryCode: code })).toBe(0);
      expect(await DailyRegistrationSnapshot.countDocuments({ countryCode: code })).toBe(0);
    }
    expect(views.find((x) => x.code === "TW")!.state).toBe("LOOKUP_ONLY");
    expect(views.find((x) => x.code === "JP")!.state).toBe("NEEDS_CREDENTIALS");
    await expectRejects(syncDate("JP", todayIn("Asia/Tokyo"), { trigger: "MANUAL" }), 400);
  });

  it("supported countries carry source attribution, official dates and update windows", async () => {
    const views = await listCountries();
    for (const code of ["PL", "US", "CA", "AU"]) {
      const v = views.find((x) => x.code === code)!;
      expect(v.dailyFeed, code).toBe(true);
      expect(v.provider?.registrationDateType, code).toBeTruthy();
      expect(v.jurisdiction.updateWindow, code).toBeTruthy();
      expect(v.jurisdiction.sources?.length, code).toBeGreaterThan(0);
    }
  });
});

/* ───────────── Poland (KRS) ───────────── */

const extract = (krs: string, date: string, extra: Partial<KrsExtract["odpis"]["dane"]["dzial1"]["siedzibaIAdres"]> = {}): KrsExtract => ({
  odpis: {
    naglowekA: { rejestr: "RejP", numerKRS: krs, dataRejestracjiWKRS: date },
    dane: {
      dzial1: {
        danePodmiotu: { formaPrawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", nazwa: `TEST ${krs} SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ`, identyfikatory: { regon: "1", nip: "2" } },
        siedzibaIAdres: { siedziba: { wojewodztwo: "MAZOWIECKIE", miejscowosc: "WARSZAWA" }, adres: { ulica: "UL. TOWAROWA", nrDomu: "28", kodPocztowy: "00-839", miejscowosc: "WARSZAWA" }, ...extra },
      },
      dzial2: { reprezentacja: { sklad: [{ nazwisko: { nazwiskoICzlon: "K*****" }, imiona: { imie: "J***" }, funkcjaWOrganie: "PREZES ZARZĄDU" }] } },
      dzial3: { przedmiotDzialalnosci: { przedmiotPrzewazajacejDzialalnosci: [{ opis: "DZIAŁALNOŚĆ ZWIĄZANA Z OPROGRAMOWANIEM", kodDzial: "62", kodKlasa: "10", kodPodklasa: "B" }] } },
    },
  },
});

describe("Poland — KRS adapter", () => {
  it("parses the official extract; masked board names are not stored", () => {
    const c = normalizeKrsExtract(extract("1274925", "23.10.2026", { adresPocztyElektronicznej: "BIURO@TEST.PL", adresStronyInternetowej: "WWW.TEST.PL" }))!;
    expect(c.identity).toEqual({ sourceId: "0001274925", name: "TEST 1274925 SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", registrationNumber: "0001274925" });
    expect(c.registration).toMatchObject({ registrationDay: "2026-10-23", legalForm: "Spółka z ograniczoną odpowiedzialnością" });
    expect(c.contact).toEqual({ email: "biuro@test.pl", website: "https://www.test.pl" });
    expect(c.classification).toMatchObject({ industryCode: "62.10.B", naceCode: "62.10", codeSystem: "PKD 2025" });
    expect(c.address.business).toMatchObject({ street: "UL. TOWAROWA 28", postalCode: "00-839", city: "Warszawa", region: "Mazowieckie" });
    expect(c.people).toBeUndefined();
    expect(krsDay("31.02.2026")).toBeUndefined();
  });

  it("marks branches of foreign companies and skips extracts without a name", () => {
    const branch: KrsExtract = {
      odpis: {
        naglowekA: { numerKRS: "0001275262", dataRejestracjiWKRS: "26.10.2026" },
        dane: { dzial1: { danePodmiotuZagranicznego: { formaPrawna: "ODDZIAŁ ZAGRANICZNEGO PRZEDSIĘBIORCY", nazwa: "EXAMPLE LTD ODDZIAŁ W POLSCE" }, siedzibaIAdresPodmiotuZagranicznego: { adres: { miejscowosc: "ŁÓDŹ", kodPocztowy: "91-174" } } } },
      },
    };
    expect(normalizeKrsExtract(branch)).toMatchObject({ eventType: "BRANCH", identity: { name: "EXAMPLE LTD ODDZIAŁ W POLSCE" }, address: { business: { city: "Łódź" } } });
    expect(normalizeKrsExtract({ odpis: { naglowekA: { numerKRS: "1" }, dane: { dzial1: {} } } })).toBeNull();
  });

  it("imports only extracts registered on the bulletin day and stops after the day's block", async () => {
    // Bulletin: the day's three new numbers on top, then 50 older entities with amendments.
    const numbers = ["0001000103", "0001000102", "0001000101", ...Array.from({ length: 50 }, (_, i) => String(900000 - i).padStart(10, "0")), "0000000001"];
    const calls: string[] = [];
    const get = async (krs: string) => {
      calls.push(krs);
      if (krs === "0001000102") return null; // an association (register S) — skipped
      return extract(krs, krs.startsWith("00010001") ? "23.10.2026" : "02.03.2015");
    };
    const r = await scanKrsDay("2026-10-23", { limit: 100 }, get, async () => numbers);
    expect(r.companies.map((c) => c.identity.registrationNumber)).toEqual(["0001000103", "0001000101"]);
    expect(calls.length).toBeLessThan(numbers.length); // stopped early
    expect(calls).not.toContain("0000000001");
  });
});

/* ───────────── United States (state open data) ───────────── */

describe("United States — state open-data adapter", () => {
  const ny = US_FEEDS.find((f) => f.state === "NY")!;
  const co = US_FEEDS.find((f) => f.state === "CO")!;
  const ct = US_FEEDS.find((f) => f.state === "CT")!;

  it("prefixes registry numbers with the state and marks foreign qualifications", () => {
    const a = normalizeUsRow(ny, { dos_id: "8055110", current_entity_name: "ROADWISE SERVICES INC.", initial_dos_filing_date: "2026-10-24T00:00:00.000", county: "Nassau", entity_type: "DOMESTIC BUSINESS CORPORATION", chairman_name: "JANE DOE" })!;
    expect(a.identity.registrationNumber).toBe("NY-8055110");
    expect(a.registration.registrationDay).toBe("2026-10-24");
    expect(a.eventType).toBe("NEW_ENTITY");
    expect(a.contactPerson).toEqual({ name: "Jane Doe", role: "Chairman / CEO (as filed)" });
    expect(a.source.url).toBe("https://data.ny.gov/resource/n9v6-gdp6.json?dos_id=8055110");
    const f = normalizeUsRow(ny, { dos_id: "1", current_entity_name: "X LLC", initial_dos_filing_date: "2026-10-24T00:00:00.000", entity_type: "FOREIGN LIMITED LIABILITY COMPANY" })!;
    expect(f.eventType).toBe("BRANCH");
    // Same number in two state registers stays two companies.
    const c1 = normalizeUsRow(co, { entityid: "8055110", entityname: "Fund RS LLC", entitytype: "DLLC", entityformdate: "2026-10-24T00:00:00.000" })!;
    expect(c1.identity.registrationNumber).toBe("CO-8055110");
    expect(c1.registration.legalForm).toBe("Limited liability company");
  });

  it("uses Connecticut's published business email and NAICS code", () => {
    const c = normalizeUsRow(ct, { accountnumber: "3535763", name: "Cadential LLC", business_type: "LLC", citizenship: "Domestic", date_registration: "2026-10-25T00:00:00.000", business_email_address: "Nicholas@CadentialGigs.com", naics_code: "Landscaping Services (561730)", create_dt: "2026-10-26 00:10:44.7700000" })!;
    expect(c.contact.email).toBe("nicholas@cadentialgigs.com");
    expect(c.classification).toMatchObject({ industryCode: "561730", codeSystem: "NAICS", industryDescription: "Landscaping Services" });
    expect(c.source.publishedAt?.toISOString()).toBe("2026-10-26T00:10:44.000Z");
  });

  it("syncs a day end to end and counts only new legal entities in the daily snapshot", async () => {
    const day = addDays(todayIn("America/New_York"), -2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const where = url.searchParams.get("$where") ?? "";
        const isCount = (url.searchParams.get("$select") ?? "").startsWith("count");
        const rows: Record<string, Record<string, string>[]> = {
          "data.ny.gov": [
            { dos_id: "9000001", current_entity_name: "HUDSON TEST LLC", initial_dos_filing_date: `${day}T00:00:00.000`, entity_type: "DOMESTIC LIMITED LIABILITY COMPANY", county: "Kings" },
            { dos_id: "9000002", current_entity_name: "OUT OF STATE INC.", initial_dos_filing_date: `${day}T00:00:00.000`, entity_type: "FOREIGN BUSINESS CORPORATION" },
          ],
          "data.colorado.gov": [{ entityid: "20261234567", entityname: "Rocky Test LLC", entitytype: "DLLC", entityformdate: `${day}T00:00:00.000`, principalcity: "Denver", principalstate: "CO" }],
          "data.ct.gov": [],
          // Oregon: one row per address / representative of the same entity.
          "data.oregon.gov": [
            { registry_number: "261601893", business_name: "MAXIEM HEIGHTS LLC", entity_type: "DOMESTIC LIMITED LIABILITY COMPANY", registry_date: `${day}T16:27:10.000`, associated_name_type: "MAILING ADDRESS", address: "PO BOX 1", city: "NORTH PLAINS", state: "OR", zip: "97133" },
            { registry_number: "261601893", business_name: "MAXIEM HEIGHTS LLC", entity_type: "DOMESTIC LIMITED LIABILITY COMPANY", registry_date: `${day}T16:27:10.000`, associated_name_type: "REGISTERED AGENT", first_name: "MAXIM", middle_name: "J", last_name: "VYSOTSKIY", address: "9905 NW BARTLETT LOOP", city: "NORTH PLAINS", state: "OR", zip: "97133" },
            { registry_number: "261601893", business_name: "MAXIEM HEIGHTS LLC", entity_type: "DOMESTIC LIMITED LIABILITY COMPANY", registry_date: `${day}T16:27:10.000`, associated_name_type: "PRINCIPAL PLACE OF BUSINESS", address: "9905 NW BARTLETT LOOP", city: "NORTH PLAINS", state: "OR", zip: "97133" },
          ],
        };
        const list = where.includes(day) ? rows[url.hostname] ?? [] : [];
        const entities = new Set(list.map((x) => x.registry_number ?? x.dos_id ?? x.entityid)).size;
        return new Response(JSON.stringify(isCount ? [{ n: String(entities), rows: String(list.length) }] : Number(url.searchParams.get("$offset") ?? 0) > 0 ? [] : list), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const r = await syncDate("US", day, { trigger: "MANUAL" });
    expect(r.status).toBe("SUCCESS");
    const stored = await Company.find({ countryCode: "US" }).lean<CompanyDoc[]>();
    expect(stored.map((c) => c.registrationNumber).sort()).toEqual(["CO-20261234567", "NY-9000001", "NY-9000002", "OR-261601893"]);
    // Oregon rows are merged: principal place of business address + the named registered agent.
    const or = stored.find((c) => c.registrationNumber === "OR-261601893") as unknown as { address?: string; city?: string; contactPerson?: { name?: string; role?: string } };
    expect(or).toMatchObject({ city: "North Plains", contactPerson: { name: "Maxim J Vysotskiy", role: "Registered agent (as filed)" } });
    expect(or.address).toContain("9905 NW BARTLETT LOOP");
    expect(stored.every((c) => c.registrationDay === day && c.sourceUrl)).toBe(true);
    const snap = await DailyRegistrationSnapshot.findOne({ countryCode: "US", date: day }).lean<{ newCompanies: number }>();
    expect(snap?.newCompanies).toBe(3); // the foreign qualification is not a new company
    // Re-running the day never duplicates records.
    await syncDate("US", day, { trigger: "MANUAL" });
    expect(await Company.countDocuments({ countryCode: "US" })).toBe(4);
  });
});

/* ───────────── Canada, Australia, Japan ───────────── */

describe("Canada — federal corporations file", () => {
  it("keeps recent rows and labels the jurisdiction in the registry number", async () => {
    const csv = [
      "﻿Corporation number,Business number (BN),Corporate name - form 1,Corporate name - form 2,Governing legislation,Status,Status Detail,Anniversary date,Year of last annual filing,Date of last annual meeting,Street,Street 2,City/town,Province/territory,Country,Postal code,Minimum number of directors,Maximum number of directors",
      '18336547,,18336547 CANADA INC.,,Canada Business Corporations Act,Active,,2026-10-26,,,"100, KING ST W",,TORONTO,ON,CA,M5X 1A9,1,10',
      "8660115,835752437,MINDANGLER CAPITAL INC.,,Canada Business Corporations Act,Active,,2013-10-10,2026,2023-10-10,515 Legget Drive,Suite 800,Ottawa,ON,CA,K2K 3G4,1,12",
    ].join("\n");
    async function* chunks() {
      yield new TextEncoder().encode(csv);
    }
    const rows = await parseCbcaFile(chunks(), "2026-10-01");
    expect(rows).toHaveLength(1);
    const c = normalizeCbcaRow(rows[0]!);
    expect(c.identity.registrationNumber).toBe("FED-18336547");
    expect(c.registration).toMatchObject({ registrationDay: "2026-10-26", legalForm: "Federal corporation (CBCA)" });
    expect(c.address.business).toMatchObject({ street: "100, KING ST W", city: "Toronto", region: "Ontario", country: "Canada" });
  });
});

describe("Australia — ASIC company dataset", () => {
  it("imports current names only, with the ASIC registration date", () => {
    expect(asicDate("2026-10-23")).toBe("23/10/2026");
    expect(asicDay("23/10/2026")).toBe("2026-10-23");
    const c = normalizeAsicRecord({ "Company Name": "SWIFT GUARD PTY LTD", ACN: "703559111", Type: "APTY", Status: "REGD", "Date of Registration": "26/10/2026", "Current Name Indicator": "Y", ABN: "0" })!;
    expect(c.identity.registrationNumber).toBe("703559111");
    expect(c.registration).toMatchObject({ registrationDay: "2026-10-26", legalForm: "Australian proprietary company", status: "Registered" });
    expect(normalizeAsicRecord({ "Company Name": "OLD NAME PTY LTD", ACN: "1", "Date of Registration": "26/10/2026", "Current Name Indicator": null })).toBeNull();
  });
});

describe("Japan — NTA Web-API (credential-gated)", () => {
  it("keeps new company designations only and labels the date honestly", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><corporations><lastUpdateDate>2026-10-23</lastUpdateDate><count>3</count><divideNumber>1</divideNumber><divideSize>1</divideSize>
      <corporation><corporateNumber>1010001000001</corporateNumber><process>01</process><kind>301</kind><name>テスト株式会社</name><enName>Test Co., Ltd.</enName><prefectureName>東京都</prefectureName><cityName>千代田区</cityName><streetNumber>1-1</streetNumber><postCode>1000001</postCode><assignmentDate>2026-10-23</assignmentDate></corporation>
      <corporation><corporateNumber>1010001000002</corporateNumber><process>12</process><kind>301</kind><name>変更株式会社</name><assignmentDate>2015-10-05</assignmentDate></corporation>
      <corporation><corporateNumber>1010001000003</corporateNumber><process>01</process><kind>101</kind><name>国の機関</name><assignmentDate>2026-10-23</assignmentDate></corporation>
    </corporations>`;
    const parsed = parseNtaXml(xml);
    expect(parsed.corporations).toHaveLength(3);
    const companies = parsed.corporations.map(normalizeNtaRecord).filter(Boolean);
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({ identity: { name: "Test Co., Ltd.", registrationNumber: "1010001000001" }, registration: { registrationDay: "2026-10-23" } });
    expect(getRegistryProvider("nta-jp")!.registrationDateType).toMatch(/not the registration date/);
    expect(getRegistryProvider("nta-jp")!.isConfigured()).toBe(false);
  });
});
