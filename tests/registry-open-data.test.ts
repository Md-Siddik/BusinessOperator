import { deflateRawSync } from "node:zlib";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Company, Country, DailyRegistrationSnapshot, type CompanyDoc } from "@/models";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { ensureCountries } from "@/features/countries/service";
import { getRegistryProvider } from "@/features/registry/providers";
import { syncDate } from "@/features/registry/sync";
import { clearBulkCache, splitCsv } from "@/features/registry/bulk-file";
import { normalizeUrRow, parseUrAddress } from "@/features/registry/providers/ur-lv";
import { parseEhak, rikDay } from "@/features/registry/providers/rik-open-data";
import { legalFormFromText } from "@/features/registry/providers/shab";
import { expectRejects } from "./helpers";

/**
 * Credential-free open-data providers: Latvia (UR register.csv), Estonia (RIK basic data
 * ZIP) and Switzerland (SHAB HR01). fetch is mocked with fixtures shaped like the real
 * files and API responses — no network access, no production data.
 */

const LV_TODAY = todayIn("Europe/Riga");
const LV_YESTERDAY = addDays(LV_TODAY, -1);
const EE_TODAY = todayIn("Europe/Tallinn");
const CH_TODAY = todayIn("Europe/Zurich");
const CH_JOURNAL = addDays(CH_TODAY, -2);
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

const LV_HEADER = "regcode;sepa;name;name_before_quotes;name_in_quotes;name_after_quotes;without_quotes;regtype;regtype_text;type;type_text;registered;terminated;closed;address;index;addressid;region;city;atvk;reregistration_term";
const lvCsv = () =>
  "﻿" +
  [
    LV_HEADER,
    `40203790611;LV90ZZZ40203790611;SIA LS Export & Sales;SIA;LS Export & Sales;"";1;K;Komercreģistrs;SIA;Sabiedrība ar ierobežotu atbildību;${LV_TODAY};; ;"Cēsu nov., Cēsis, Palejas iela 9";4101;101586087;100016487;100003157;0026200;`,
    `40203790560;LV12ZZZ40203790560;"SIA ""Vastium""";SIA;Vastium;"";0;K;Komercreģistrs;SIA;Sabiedrība ar ierobežotu atbildību;${LV_YESTERDAY};; ;"Daugavpils, Grodņas iela 15 - 9";5404;116113583;0;100003011;0002000;`,
    `40008234596;LV49ZZZ40008234596;"""House of Glory""";"";House of Glory;"";0;B;Biedrību un nodibinājumu reģistrs;BDR;Biedrība;${LV_TODAY};; ;Rīga, Latgales iela 180 - 5;1019;112303082;0;100003003;"";`,
    `41202013815;LV53ZZZ41202013815;"IK ""KRASTNIEKI A I""";IK;KRASTNIEKI A I;"";0;K;Komercreģistrs;IK;Individuālais komersants;1998-02-26;2014-04-10;L;"Dundagas nov., Kolkas pag., Kolka, ""Krastnieki""";3275;103045133;100015821;0;0885162;`,
  ].join("\r\n");

const EE_HEADER = "nimi;ariregistri_kood;ettevotja_oiguslik_vorm;ettevotja_oigusliku_vormi_alaliik;kmkr_nr;ettevotja_staatus;ettevotja_staatus_tekstina;ettevotja_esmakande_kpv;ettevotja_aadress;asukoht_ettevotja_aadressis;asukoha_ehak_kood;asukoha_ehak_tekstina;indeks_ettevotja_aadressis;ads_adr_id;ads_ads_oid;ads_normaliseeritud_taisaadress;teabesysteemi_link";
const eeCsv = () =>
  "﻿" +
  [
    EE_HEADER,
    `Adlas OÜ;17626063;Osaühing;;;R;Registrisse kantud;${dmy(EE_TODAY)};;Pöörise tn 5-67;0482;Mustamäe linnaosa, Tallinn, Harju maakond;13520;3435686;;Harju maakond, Tallinn, Mustamäe linnaosa, Pöörise tn 5-67;https://ariregister.rik.ee/est/company/17626063`,
    `Mari Maasikas FIE;17626100;Füüsilisest isikust ettevõtja;;;R;Registrisse kantud;${dmy(EE_TODAY)};;Turu tn 34;8151;Tartu linn, Tartu linn, Tartu maakond;51004;3047590;;;https://ariregister.rik.ee/est/company/17626100`,
    `007 Autohaus osaühing;11694365;Osaühing;;EE101335276;R;Registrisse kantud;30.07.2009;;Turu tn 34;8151;Tartu linn, Tartu linn, Tartu maakond;51004;3047590;;;https://ariregister.rik.ee/est/company/11694365`,
  ].join("\n");

/** Minimal single-entry ZIP (deflate), laid out like the RIK download. */
function zip(name: string, content: string) {
  const raw = Buffer.from(content, "utf8");
  const data = deflateRawSync(raw);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, central, n, eocd]);
}

function hr01(id: string, uid: string, name: string, legalFormCode: string, legalForm: string) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<HR01:publication xmlns:HR01="https://shab.ch/shab/HR01-export">
<meta><id>${id}</id><subRubric>HR01</subRubric><language>de</language><publicationDate>${CH_TODAY}</publicationDate><cantons>AG</cantons></meta>
<content><journalNumber>14630</journalNumber><journalDate>${CH_JOURNAL}</journalDate>
<publicationText>${name}, in Wohlen (AG), ${uid}, Nordstrasse 5, 5610 Wohlen AG, ${legalForm} (Neueintragung). Zweck: Handel.</publicationText>
<commonsNew><company><name>${name}</name><uid>${uid}</uid><seat>Wohlen (AG)</seat><legalForm>${legalFormCode}</legalForm><address><street>Nordstrasse</street><houseNumber>5</houseNumber><swissZipCode>5610</swissZipCode><town>Wohlen AG</town></address></company><purpose>Handel mit Waren aller Art.</purpose></commonsNew>
</content></HR01:publication>`;
}
const SHAB = [
  { id: "11111111-aaaa-4aaa-8aaa-000000000001", xml: hr01("11111111-aaaa-4aaa-8aaa-000000000001", "CHE-191.375.871", "CEMA Trading GmbH", "0107", "Gesellschaft mit beschränkter Haftung") },
  { id: "11111111-aaaa-4aaa-8aaa-000000000002", xml: hr01("11111111-aaaa-4aaa-8aaa-000000000002", "CHE-222.333.444", "Alpen Bau AG", "0105", "Aktiengesellschaft") },
  { id: "11111111-aaaa-4aaa-8aaa-000000000003", xml: hr01("11111111-aaaa-4aaa-8aaa-000000000003", "CHE-555.666.777", "Muster Malerei Hans Muster", "0101", "Einzelunternehmen") },
];

/** Mutable fixture state per test. */
const fx = { lvEtag: '"lv-1"', lvGets: 0, eeFail: false, shabMissingXml: new Set<string>(), shabListStatus: 200 };

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const head = init?.method === "HEAD";
  if (url.includes("data.gov.lv") && url.endsWith("register.csv")) {
    if (!head) fx.lvGets++;
    return Promise.resolve(new Response(head ? null : lvCsv(), { status: 200, headers: { etag: fx.lvEtag, "last-modified": "Fri, 16 Oct 2026 20:25:07 GMT", "content-type": "text/csv" } }));
  }
  if (url.includes("package_show?id=uz")) return Promise.resolve(Response.json({ success: true, result: { resources: [{ url: "https://x/register.csv", last_modified: "2026-10-16T20:25:06.378130" }] } }));
  if (url.includes("avaandmed.ariregister.rik.ee")) {
    if (fx.eeFail) return Promise.resolve(new Response("unavailable", { status: 503 }));
    return Promise.resolve(new Response(head ? null : zip("ettevotja_rekvisiidid__lihtandmed.csv", eeCsv()), { status: 200, headers: { etag: '"ee-1"', "last-modified": "Sat, 17 Oct 2026 08:24:34 GMT", "content-type": "application/zip" } }));
  }
  if (url.includes("amtsblattportal.ch/api/v1/publications?")) {
    if (fx.shabListStatus !== 200) return Promise.resolve(new Response("boom", { status: fx.shabListStatus }));
    const day = new URL(url).searchParams.get("publicationDate.start");
    const content = day === CH_TODAY ? SHAB.map((s) => ({ meta: { id: s.id, publicationDate: `${CH_TODAY}T00:00:00.000Z` } })) : [];
    return Promise.resolve(Response.json({ total: content.length, content }));
  }
  const m = /publications\/([0-9a-f-]+)\/xml$/.exec(url);
  if (m) {
    const s = SHAB.find((x) => x.id === m[1]);
    if (!s || fx.shabMissingXml.has(s.id)) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(new Response(s.xml, { status: 200, headers: { "content-type": "application/xml" } }));
  }
  return Promise.reject(new Error(`Unexpected request in test: ${url}`));
}

beforeAll(async () => {
  await ensureCountries();
});
beforeEach(() => {
  clearBulkCache();
  (globalThis as unknown as { __etHttpCircuits?: Map<string, unknown> }).__etHttpCircuits?.clear();
  Object.assign(fx, { lvEtag: '"lv-1"', lvGets: 0, eeFail: false, shabMissingXml: new Set<string>(), shabListStatus: 200 });
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => vi.unstubAllGlobals());

describe("parsing helpers", () => {
  it("splits ;-separated lines with RFC 4180 quoting", () => {
    expect(splitCsv('1;"SIA ""Vastium""";;"a;b"')).toEqual(["1", 'SIA "Vastium"', "", "a;b"]);
  });
  it("reads UR addresses (municipality, city, street) and LV postcodes", () => {
    expect(parseUrAddress("Cēsu nov., Cēsis, Palejas iela 9", "4101")).toMatchObject({ region: "Cēsu nov.", city: "Cēsis", street: "Palejas iela 9", postalCode: "LV-4101" });
    expect(parseUrAddress("Rīga, Latgales iela 180 - 5", "1019")).toMatchObject({ city: "Rīga", street: "Latgales iela 180 - 5" });
    expect(parseUrAddress('Dundagas nov., Kolkas pag., Kolka, "Krastnieki"')).toMatchObject({ region: "Dundagas nov.", city: "Kolka", street: '"Krastnieki"' });
  });
  it("reads RIK dates and EHAK areas", () => {
    expect(rikDay("16.10.2026")).toBe("2026-10-16");
    expect(rikDay("2026-10-16")).toBeUndefined();
    expect(parseEhak("Mustamäe linnaosa, Tallinn, Harju maakond")).toEqual({ city: "Tallinn", region: "Harju maakond" });
    expect(parseEhak("Tartu linn, Tartu linn, Tartu maakond")).toEqual({ city: "Tartu", region: "Tartu maakond" });
  });
  it("takes the Swiss legal form from the publication text, as published", () => {
    expect(legalFormFromText("X GmbH, in Wohlen (AG), CHE-1, Nordstrasse 5, 5610 Wohlen AG, Gesellschaft mit beschränkter Haftung (Neueintragung). Zweck: …")).toBe("Gesellschaft mit beschränkter Haftung");
    expect(legalFormFromText("Y SA, à Genève, CHE-2, Rue 1, 1200 Genève, société anonyme (Nouvelle inscription).")).toBe("société anonyme");
  });
  it("never invents contact data", () => {
    const c = normalizeUrRow({ regcode: "1", name: "SIA A", regtype: "K", regtype_text: "", type: "SIA", type_text: "SIA", registered: LV_TODAY, terminated: "", address: "", index: "" });
    expect(c.contact).toEqual({});
  });
});

describe("Latvia — UR open data", () => {
  const lv = () => getRegistryProvider("ur-lv")!;

  it("is open (no credentials) and lists only business-register entities of the requested day", async () => {
    expect(lv().isConfigured()).toBe(true);
    expect(lv().requiredEnv).toEqual([]);
    const today = await lv().getRegistrations!(LV_TODAY, LV_TODAY, { limit: 100 });
    expect(today.companies.map((c) => c.identity.registrationNumber)).toEqual(["40203790611"]); // the association (B) is excluded
    expect(today.companies[0]).toMatchObject({ identity: { name: "SIA LS Export & Sales" }, registration: { registrationDay: LV_TODAY, legalFormCode: "SIA", status: "Registered" } });
    const both = await lv().getRegistrations!(LV_YESTERDAY, LV_TODAY, { limit: 100 });
    expect(both.companies.map((c) => c.identity.name).sort()).toEqual(['SIA "Vastium"', "SIA LS Export & Sales"]);
  });

  it("downloads the file once per publication (ETag) and again when it changes", async () => {
    await lv().getRegistrations!(LV_TODAY, LV_TODAY, { limit: 100 });
    await lv().getRegistrations!(LV_YESTERDAY, LV_YESTERDAY, { limit: 100 });
    expect(fx.lvGets).toBe(1);
    fx.lvEtag = '"lv-2"';
    await lv().getRegistrations!(LV_TODAY, LV_TODAY, { limit: 100 });
    expect(fx.lvGets).toBe(2);
  });

  it("returns an empty, complete batch for a day without registrations", async () => {
    const r = await lv().getRegistrations!(addDays(LV_TODAY, -30), addDays(LV_TODAY, -30), { limit: 100 });
    expect(r).toMatchObject({ companies: [], total: 0, complete: true });
  });

  it("persists real records under the country, and a repeated sync creates no duplicates", async () => {
    const first = await syncDate("LV", LV_TODAY, { trigger: "MANUAL" });
    expect(first).toMatchObject({ status: "SUCCESS", fetched: 1, imported: 1 });
    const again = await syncDate("LV", LV_TODAY, { trigger: "MANUAL" });
    expect(again.imported).toBe(0);
    const docs = await Company.find({ countryCode: "LV" }).lean<CompanyDoc[]>();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ source: "ur-lv", registrationNumber: "40203790611", registrationDay: LV_TODAY, isDemo: false, city: "Cēsis" });
    expect(docs[0]!.email ?? undefined).toBeUndefined();
    expect(docs[0]!.phone ?? undefined).toBeUndefined();
  });
});

describe("Estonia — RIK open data", () => {
  const ee = () => getRegistryProvider("rik-open-data")!;

  it("is the default Estonian provider; the contract XML provider stays available", async () => {
    expect((await Country.findOne({ code: "EE" }).lean<{ providerId: string }>())?.providerId).toBe("rik-open-data");
    expect(getRegistryProvider("rik")?.countryCode).toBe("EE");
  });

  it("moves a stored, unconfigured contract provider to open data — but never a configured one", async () => {
    await Country.updateOne({ code: "EE" }, { $set: { providerId: "rik" } });
    await ensureCountries();
    expect((await Country.findOne({ code: "EE" }).lean<{ providerId: string }>())?.providerId).toBe("rik-open-data");

    await Country.updateOne({ code: "EE" }, { $set: { providerId: "rik" } });
    process.env.ESTONIA_RIK_USERNAME = "user";
    process.env.ESTONIA_RIK_PASSWORD = "pass";
    try {
      await ensureCountries();
      expect((await Country.findOne({ code: "EE" }).lean<{ providerId: string }>())?.providerId).toBe("rik");
    } finally {
      delete process.env.ESTONIA_RIK_USERNAME;
      delete process.env.ESTONIA_RIK_PASSWORD;
      await Country.updateOne({ code: "EE" }, { $set: { providerId: "rik-open-data" } });
    }
    // Working providers are untouched.
    expect((await Country.findOne({ code: "NO" }).lean<{ providerId: string }>())?.providerId).toBe("brreg");
  });

  it("reads the ZIP, converts dd.mm.yyyy, keeps the official link and skips sole traders", async () => {
    const r = await ee().getRegistrations!(EE_TODAY, EE_TODAY, { limit: 100 });
    expect(r.companies).toHaveLength(1);
    expect(r.companies[0]).toMatchObject({
      identity: { name: "Adlas OÜ", registrationNumber: "17626063" },
      registration: { registrationDay: EE_TODAY, legalForm: "Osaühing", status: "Registrisse kantud" },
      address: { business: { street: "Pöörise tn 5-67", postalCode: "13520", city: "Tallinn", region: "Harju maakond" } },
      source: { url: "https://ariregister.rik.ee/est/company/17626063" },
      contact: {},
    });
  });

  it("fails clearly on an invalid file", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => (String(input).includes("rik.ee") ? Promise.resolve(new Response(init?.method === "HEAD" ? null : "<html>not a zip</html>", { status: 200, headers: { etag: '"bad"' } })) : fakeFetch(input, init))));
    await expect(ee().getRegistrations!(EE_TODAY, EE_TODAY, { limit: 100 })).rejects.toThrow(/ZIP/);
  });

  it("a failing Estonian source fails only the Estonian sync", async () => {
    await Company.create({ companyName: "Protected Norway AS", countryCode: "NO", source: "brreg", sourceId: "999000111", registrationDay: EE_TODAY });
    fx.eeFail = true;
    const ee = await syncDate("EE", EE_TODAY, { trigger: "MANUAL" });
    expect(ee.status).toBe("FAILED");
    fx.eeFail = false;
    const lv = await syncDate("LV", LV_YESTERDAY, { trigger: "MANUAL" });
    expect(lv.status).toBe("SUCCESS");
    expect(await Company.countDocuments({ countryCode: "EE" })).toBe(0);
    expect(await Company.countDocuments({ countryCode: "NO", source: "brreg" })).toBe(1);
  });
});

describe("Switzerland — SHAB HR01", () => {
  const ch = () => getRegistryProvider("shab")!;

  it("selects by publication day and stores the real journal (registration) date", async () => {
    expect(ch().windowBy).toBe("publication");
    const r = await ch().getRegistrations!(CH_TODAY, CH_TODAY, { limit: 100 });
    expect(r.total).toBe(3);
    // The sole proprietorship (0101) is excluded by default.
    expect(r.companies.map((c) => c.identity.name).sort()).toEqual(["Alpen Bau AG", "CEMA Trading GmbH"]);
    expect(r.companies.find((c) => c.identity.name === "CEMA Trading GmbH")).toMatchObject({
      identity: { registrationNumber: "CHE-191.375.871" },
      registration: { registrationDay: CH_JOURNAL, legalForm: "Gesellschaft mit beschränkter Haftung", legalFormCode: "0107" },
      address: { business: { street: "Nordstrasse 5", postalCode: "5610", city: "Wohlen AG", region: "AG" } },
      classification: { purpose: "Handel mit Waren aller Art." },
      contact: {},
    });
    expect(r.companies[0]!.source.url).toMatch(/\/publications\/[0-9a-f-]+\/pdf$/);
  });

  it("tolerates a few unreadable publications but fails a broken source", async () => {
    fx.shabMissingXml.add(SHAB[0]!.id);
    const partial = await ch().getRegistrations!(CH_TODAY, CH_TODAY, { limit: 100 });
    expect(partial.companies.map((c) => c.identity.name)).toEqual(["Alpen Bau AG"]);
    expect(partial.complete).toBe(false);
    fx.shabListStatus = 404;
    await expect(ch().getRegistrations!(CH_TODAY, CH_TODAY, { limit: 100 })).rejects.toThrow(/404/);
  });

  it("rebuilds the daily count of the earlier registration day it filled", async () => {
    const r = await syncDate("CH", CH_TODAY, { trigger: "MANUAL" });
    expect(r).toMatchObject({ status: "SUCCESS", imported: 2 });
    expect(await Company.countDocuments({ countryCode: "CH", registrationDay: CH_JOURNAL })).toBe(2);
    const snap = await DailyRegistrationSnapshot.findOne({ countryCode: "CH", date: CH_JOURNAL, isDemo: false }).lean<{ newCompanies: number }>();
    expect(snap?.newCompanies).toBe(2);
  });

  it("rejects future dates like every other provider", async () => {
    await expectRejects(syncDate("CH", addDays(CH_TODAY, 2), { trigger: "MANUAL" }), 400);
  });
});
