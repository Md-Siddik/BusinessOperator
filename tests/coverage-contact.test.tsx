import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Company, Contact, Country, DailyRegistrationSnapshot, Job, type CompanyDoc, type ContactDoc } from "@/models";
import { JURISDICTIONS } from "@/config/jurisdictions";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { compareCountries, countryNavMeta, countryStatus, countryTier, sortCountries, type CountryRankInput } from "@/lib/integration-state";
import { ensureCountries, listCountries } from "@/features/countries/service";
import { getCompanyDetail, listCompanies } from "@/features/companies/service";
import { exportCompanies, listCountryCards } from "@/features/companies/registrations";
import { getRegistryProvider } from "@/features/registry/providers";
import { syncDate } from "@/features/registry/sync";
import { normalizeBodacc, parseAdministration, type BodaccRecord } from "@/features/registry/providers/bodacc";
import { normalizeAres, type AresVrRecord } from "@/features/registry/providers/ares-cz";
import { researchCompany, scheduleDueRetries } from "@/features/research/engine";
import { domainCandidates, extractFromPage, identityEvidence } from "@/features/research/website";
import { runEnrichment } from "@/features/intelligence/enrichment";
import { sendEmail } from "@/features/email-sender/service";
import { ContactStatus } from "@/components/intel/contact-status";
import type { CompanyRow } from "@/components/intel/types";
import { expectRejects, makeTenants } from "./helpers";

/**
 * Free-coverage expansion + contact enrichment. Network access is mocked: fetch serves
 * fixtures shaped like the real BODACC / ARES responses and fictional company websites
 * (.ch test domains with fictional companies), and DNS resolves every host to a public
 * documentation address. Nothing here is production data.
 */
vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "203.0.113.10", family: 4 }];
  const resolveMx = async () => [{ exchange: "mx.test", priority: 10 }];
  class Resolver {
    setServers() {}
    resolveMx = resolveMx;
  }
  const mod = { lookup, resolveMx, Resolver };
  return { ...mod, default: mod };
});

let t: Awaited<ReturnType<typeof makeTenants>>;
const FR_TODAY = todayIn("Europe/Paris");
const FR_REG = addDays(FR_TODAY, -3);
const CZ_TODAY = todayIn("Europe/Prague");
const CZ_REG = addDays(CZ_TODAY, -2);

/* ───────────── Fixtures ───────────── */

const bodacc = (id: string, p: Record<string, unknown>, acte: Record<string, unknown>, extra: Partial<BodaccRecord> = {}): BodaccRecord => ({
  id,
  dateparution: FR_TODAY,
  typeavis: "annonce",
  familleavis: "creation",
  commercant: String(p.denomination ?? p.nom ?? ""),
  ville: "Lyon",
  cp: "69002",
  registre: [String((p.numeroImmatriculation as { numeroIdentification: string }).numeroIdentification).replace(/\s/g, "")],
  departement_nom_officiel: "Rhône",
  listepersonnes: JSON.stringify({ personne: p }),
  listeetablissements: JSON.stringify({ etablissement: { activite: "Conseil en systèmes informatiques", adresse: { codePostal: "69002", ville: "Lyon" } } }),
  acte: JSON.stringify(acte),
  url_complete: `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`,
  ...extra,
});

const BODACC_RECORDS: BodaccRecord[] = [
  bodacc(
    "A1",
    {
      typePersonne: "pm",
      numeroImmatriculation: { numeroIdentification: "900 000 001" },
      denomination: "LUMEN CONSEIL",
      formeJuridique: "Société par actions simplifiée",
      administration: "Président : MARTIN Claire nom d'usage : MARTIN. Directeur général : DUPONT, Paul, Henri",
      adresseSiegeSocial: { numeroVoie: "12", typeVoie: "rue", nomVoie: "de la République", codePostal: "69002", ville: "Lyon" },
    },
    { dateImmatriculation: FR_REG, creation: { categorieCreation: "Immatriculation d'une personne morale (B, C, D) suite à création d'un établissement principal" } },
  ),
  // No immatriculation date → skipped (publication date is never used instead).
  bodacc("A2", { typePersonne: "pm", numeroImmatriculation: { numeroIdentification: "900 000 002" }, denomination: "SANS DATE SAS" }, { dateCommencementActivite: FR_REG }),
  // Natural person (sole trader) → excluded by default.
  bodacc("A3", { typePersonne: "pp", numeroImmatriculation: { numeroIdentification: "900 000 003" }, nom: "DURAND", prenom: "Luc" }, { dateImmatriculation: FR_REG }),
  // Company officer that is itself a company — never the contact person.
  bodacc(
    "A4",
    { typePersonne: "pm", numeroImmatriculation: { numeroIdentification: "900 000 004" }, denomination: "HOLDCO TEST", formeJuridique: "Société civile", administration: "Gérant : ALPHA GESTION SAS" },
    { dateImmatriculation: FR_REG, creation: { categorieCreation: "Immatriculation d'une personne morale suite à transfert du siège" } },
  ),
];

const ARES_BATCHES = [
  { cisloDavky: 900, datovyZdroj: "vr", datumUvolneniDavky: CZ_TODAY, pocetZmen: 4 },
  { cisloDavky: 899, datovyZdroj: "vr", datumUvolneniDavky: addDays(CZ_TODAY, -5), pocetZmen: 1 },
];
const vr = (ico: string, name: string, form: string, day: string, extra: Partial<AresVrRecord> = {}): AresVrRecord => ({
  rejstrik: "OR",
  primarniZaznam: true,
  ico,
  datumZapisu: day,
  obchodniJmeno: [{ datumZapisu: day, hodnota: name }],
  pravniForma: [{ datumZapisu: day, hodnota: form }],
  stavSubjektu: "AKTIVNI",
  adresy: [{ datumZapisu: day, typAdresy: "SIDLO", adresa: { nazevUlice: "Cihelní", cisloDomovni: 668, cisloOrientacni: 1, nazevObce: "Karviná", psc: 73506, nazevKraje: "Moravskoslezský kraj" } }],
  cinnosti: { predmetPodnikani: [{ datumZapisu: day, hodnota: "Výroba, obchod a služby" }] },
  statutarniOrgany: [{ nazevOrganu: "Statutární orgán", clenoveOrganu: [{ clenstvi: { funkce: { nazev: "Jednatel" } }, fyzickaOsoba: { jmeno: "IVANA", prijmeni: "NOVÁKOVÁ" } }] }],
  ...extra,
});
const ARES_RECORDS: Record<string, AresVrRecord> = {
  "30000001": vr("30000001", "Testovací Služby s.r.o.", "112", CZ_REG),
  "30000002": vr("30000002", "Klub Přátel z.s.", "706", CZ_REG), // association → excluded by default
  "29300070": vr("29300070", "Staré Družstvo, v likvidaci", "205", "2011-11-25"), // re-inserted old entity → not new
};

/** Fictional company websites (identity, contacts and structured data as a real site publishes them). */
const SITES: Record<string, string> = {
  "https://alpenblickberatung.ch/": `<html><body><h1>Alpenblick Beratung GmbH</h1><p>UID CHE-123.456.789</p><a href="/kontakt">Kontakt</a>
    <a href="mailto:info@alpenblickberatung.ch">info@alpenblickberatung.ch</a></body></html>`,
  "https://alpenblickberatung.ch/kontakt": `<html><body>
    <a href="mailto:info@alpenblickberatung.ch">Mail</a> <a href="mailto:noreply@alpenblickberatung.ch">no reply</a>
    <a href="tel:+41441234567">Tel</a> <a href="tel:+41000000000">Fax</a>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Alpenblick Beratung GmbH",
      "founder":{"@type":"Person","name":"Anna Muster","jobTitle":"Geschäftsführerin"},
      "publisher":{"@type":"Organization","name":"Web Agentur","telephone":"+41315550123","email":"hello@webagentur.example"}}</script>
    </body></html>`,
  "https://leer.ch/": `<html><body><h1>Leer Handels AG</h1><p>Willkommen.</p></body></html>`,
};

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  if (url.hostname === "bodacc-datadila.opendatasoft.com") {
    const where = url.searchParams.get("where") ?? "";
    if (!where.includes("dateparution=")) return json({ total_count: 1, results: [{ dateparution: FR_TODAY }] });
    const day = /dateparution=date'(\d{4}-\d{2}-\d{2})'/.exec(where)?.[1];
    let rows = day === FR_TODAY ? BODACC_RECORDS : [];
    if (where.includes(`\\"pm\\"`)) rows = rows.filter((r) => r.listepersonnes!.includes(`"pm"`));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return json({ total_count: rows.length, results: rows.slice(offset, offset + Number(url.searchParams.get("limit") ?? 100)) });
  }
  if (url.hostname === "ares.gov.cz") {
    if (url.pathname.endsWith("/ekonomicke-subjekty-notifikace/vyhledat") && init?.method === "POST") return json({ notifikacniDavky: ARES_BATCHES });
    const batch = /cislo-davky\/(\d+)$/.exec(url.pathname)?.[1];
    if (batch === "900") return json({ cisloDavky: 900, seznamNotifikaci: [{ typZmeny: "INS", icoId: "30000001" }, { typZmeny: "INS", icoId: "30000002" }, { typZmeny: "INS", icoId: "29300070" }, { typZmeny: "UPD", icoId: "27074358" }, { typZmeny: "INS", icoId: "ARES_123" }] });
    if (batch === "899") return json({ cisloDavky: 899, seznamNotifikaci: [{ typZmeny: "INS", icoId: "30000009" }] });
    const ico = /ekonomicke-subjekty-vr\/(\d{8})$/.exec(url.pathname)?.[1];
    if (ico) return ARES_RECORDS[ico] ? json({ icoId: ico, zaznamy: [ARES_RECORDS[ico]] }) : json({ kod: "NENALEZENO" }, 404);
    return json({}, 404);
  }
  // Company websites
  if (url.pathname === "/robots.txt") return Promise.resolve(new Response("", { status: 404 }));
  if (url.hostname === "down.ch") return Promise.reject(new TypeError("fetch failed"));
  if (url.hostname === "slow.ch") return Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  const html = SITES[url.toString()] ?? SITES[`${url.toString()}/`];
  if (html) return Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  return Promise.reject(new TypeError("getaddrinfo ENOTFOUND"));
}

beforeAll(async () => {
  t = await makeTenants();
  await ensureCountries();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ───────────── Protected providers ───────────── */

describe("Working countries stay protected", () => {
  const PROTECTED: Record<string, string> = { NO: "brreg", FI: "prh", IE: "cro", LV: "ur-lv", EE: "rik-open-data", CH: "shab" };

  it("keeps provider ids, default providers and the connected catalogue state", async () => {
    for (const [code, id] of Object.entries(PROTECTED)) {
      const j = JURISDICTIONS.find((x) => x.code === code)!;
      expect(j.providers[0]).toBe(id);
      expect(j.state).toBe("CONNECTED");
      const p = getRegistryProvider(id)!;
      expect(p.countryCode).toBe(code);
      expect(p.isConfigured()).toBe(true);
      expect(p.capabilities.supportsDailyRegistrations).toBe(true);
    }
    const views = await listCountries();
    for (const [code, id] of Object.entries(PROTECTED)) expect(views.find((v) => v.code === code)!.providerId).toBe(id);
  });
});

/* ───────────── New free providers ───────────── */

describe("France — BODACC creations (free, no key)", () => {
  it("parses officers as published and never picks a corporate officer as contact person", () => {
    expect(parseAdministration("Président : MARTIN Claire nom d'usage : MARTIN. Directeur général : DUPONT, Paul, Henri")).toEqual([
      { name: "Martin Claire", role: "Président", group: "Management" },
      { name: "Paul Dupont", role: "Directeur général", group: "Management" },
    ]);
    expect(parseAdministration("Gérant : LUX, Jérémy, Associé indéfiniment responsable : CTA DOUZY").map((p) => [p.role, p.name, p.group])).toEqual([
      ["Gérant", "Jérémy Lux", "Management"],
      ["Associé indéfiniment responsable", "CTA DOUZY", "Corporate officer"],
    ]);
    expect(normalizeBodacc(BODACC_RECORDS[3]!)!.contactPerson).toBeUndefined();
    expect(normalizeBodacc(BODACC_RECORDS[3]!)!.eventType).toBe("RELOCATION");
  });

  it("stores each legal person under its RCS registration date; skips undated notices and sole traders", async () => {
    expect(getRegistryProvider("bodacc")!.isConfigured()).toBe(true);
    expect(getRegistryProvider("bodacc")!.requiredEnv).toEqual([]);
    const batch = await getRegistryProvider("bodacc")!.getRegistrations!(FR_TODAY, FR_TODAY, { limit: 100 });
    expect(batch.companies.map((c) => c.identity.registrationNumber).sort()).toEqual(["900000001", "900000004"]);
    const lumen = batch.companies.find((c) => c.identity.registrationNumber === "900000001")!;
    expect(lumen).toMatchObject({
      identity: { name: "LUMEN CONSEIL" },
      registration: { registrationDay: FR_REG, legalForm: "Société par actions simplifiée" },
      address: { business: { street: "12 rue de la République", postalCode: "69002", city: "Lyon", region: "Rhône" } },
      contactPerson: { name: "Martin Claire", role: "Président" },
      contact: {},
    });

    const r = await syncDate("FR", FR_TODAY, { trigger: "MANUAL", notify: false });
    expect(r.status).toBe("SUCCESS");
    const stored = await Company.findOne({ countryCode: "FR", registrationNumber: "900000001" }).lean<CompanyDoc>();
    expect(stored).toMatchObject({ registrationDay: FR_REG, source: "bodacc", sourceType: "OFFICIAL_OPEN_DATA", eventType: "NEW_ENTITY" });
    expect(stored!.contactSources?.contactPerson?.kind).toBe("REGISTRY");
    expect(stored!.contactFlags?.person).toBe(true);
    expect(stored!.email ?? null).toBeNull(); // the registry publishes no email — none is invented
    expect(await Company.countDocuments({ countryCode: "FR", registrationNumber: { $in: ["900000002", "900000003"] } })).toBe(0);
  });
});

describe("Czechia — ARES notification batches (free, no key)", () => {
  it("normalizes a public-register record; excludes non-profits", () => {
    const n = normalizeAres("30000001", ARES_RECORDS["30000001"])!;
    expect(n).toMatchObject({
      identity: { sourceId: "30000001", name: "Testovací Služby s.r.o.", registrationNumber: "30000001" },
      registration: { registrationDay: CZ_REG, legalForm: "Společnost s ručením omezeným", legalFormCode: "112", status: "Active" },
      address: { business: { street: "Cihelní 668/1", postalCode: "73506", city: "Karviná" } },
      contactPerson: { name: "Ivana Nováková", role: "Jednatel" },
    });
    expect(normalizeAres("30000002", ARES_RECORDS["30000002"])).toBeNull();
  });

  it("imports only new business entities from batches released in the window", async () => {
    const batch = await getRegistryProvider("ares-cz")!.getRegistrations!(CZ_TODAY, CZ_TODAY, { limit: 100 });
    expect(batch.companies.map((c) => c.identity.sourceId)).toEqual(["30000001"]); // not the association, not the 2011 re-insert, not batch 899
    expect(batch.companies[0]!.source.publishedAt?.toISOString().slice(0, 10)).toBe(CZ_TODAY);

    const r = await syncDate("CZ", CZ_TODAY, { trigger: "MANUAL", notify: false });
    expect(r.status).toBe("SUCCESS");
    expect(await Company.findOne({ countryCode: "CZ", registrationNumber: "30000001" }).lean<CompanyDoc>()).toMatchObject({ registrationDay: CZ_REG, source: "ares-cz", contactPerson: { name: "Ivana Nováková" } });
    const snap = await DailyRegistrationSnapshot.findOne({ countryCode: "CZ", date: CZ_REG, isDemo: false }).lean<{ newCompanies: number }>();
    expect(snap?.newCompanies).toBe(1);
  });

  it("supports single-company lookup for the research registry re-check", async () => {
    expect((await getRegistryProvider("ares-cz")!.getCompany!("30000001"))?.identity.name).toBe("Testovací Služby s.r.o.");
    expect(await getRegistryProvider("ares-cz")!.getCompany!("99999999")).toBeNull();
  });
});

/* ───────────── Credential-gated and unavailable countries ───────────── */

describe("Honest country states", () => {
  it("keeps credential-required, paid and unavailable countries out of LIVE", async () => {
    const views = await listCountries();
    const v = (code: string) => views.find((x) => x.code === code)!;
    const rank = (code: string): CountryRankInput => ({ name: v(code).name, state: v(code).state, adapterReady: !!v(code).provider && !v(code).provider!.catalogueState && v(code).provider!.capabilities.supportsDailyRegistrations, paid: v(code).provider?.accessType === "COMMERCIAL", lastSuccessAt: v(code).lastSuccessAt, coverage: null });
    expect(v("GB").state).toBe("NEEDS_CREDENTIALS");
    expect(countryStatus(rank("GB"))).toBe("READY");
    expect(countryStatus(rank("NL"))).toBe("PAID"); // KVK API is a paid subscription
    expect(countryStatus(rank("DE"))).toBe("PAID"); // OpenRegister is commercial
    expect(countryStatus(rank("SK"))).toBe("NA");
    expect(countryStatus(rank("VA"))).toBe("NA");
    expect(countryNavMeta({ ...rank("GB"), today: null }).meta).toBe("READY");
    expect(countryNavMeta({ ...rank("SK"), today: null }).meta).toBe("N/A");
  });

  it("moves France to BODACC only while the INSEE key is missing", async () => {
    await Country.updateOne({ code: "FR" }, { $set: { providerId: "insee-sirene" } });
    await ensureCountries();
    expect((await Country.findOne({ code: "FR" }).lean<{ providerId: string }>())!.providerId).toBe("bodacc");
  });
});

/* ───────────── Sorting ───────────── */

describe("Country priority", () => {
  const cov = (total: number, withDirect: number) => ({ days: 30, total, withEmail: withDirect, withPhone: 0, withWebsite: 0, withPerson: 0, withDirect });
  const now = new Date();
  const list: CountryRankInput[] = [
    { name: "Austria", state: "UNDER_RESEARCH", adapterReady: false },
    { name: "Netherlands", state: "NEEDS_CREDENTIALS", adapterReady: true, paid: true },
    { name: "Ireland", state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(18, 0) },
    { name: "United Kingdom", state: "NEEDS_CREDENTIALS", adapterReady: true },
    { name: "Norway", state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(400, 60) },
    { name: "Czechia", state: "NOT_SYNCED", adapterReady: true },
    { name: "Sweden", state: "LOOKUP_ONLY", adapterReady: false },
    { name: "Latvia", state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(235, 0) },
  ];

  it("puts live + contactable first, then live, connected, ready, paid, partial, n/a", () => {
    expect(sortCountries(list).map((c) => c.name)).toEqual(["Norway", "Ireland", "Latvia", "Czechia", "United Kingdom", "Netherlands", "Sweden", "Austria"]);
    expect(countryTier(list[4]!)).toBe(1);
    expect(countryTier(list[2]!)).toBe(2);
  });

  it("is never LIVE without synchronized records, and a stale sync ranks after a fresh one", () => {
    expect(countryStatus({ name: "X", state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(0, 0) })).toBe("NOT_SYNCED");
    expect(countryStatus({ name: "X", state: "CONNECTED", adapterReady: true, lastSuccessAt: null, coverage: cov(5, 0) })).toBe("NOT_SYNCED");
    const stale = { name: "A", state: "CONNECTED", adapterReady: true, lastSuccessAt: new Date(Date.now() - 5 * 86_400_000), coverage: cov(100, 0) };
    const fresh = { name: "Z", state: "CONNECTED", adapterReady: true, lastSuccessAt: now, coverage: cov(100, 0) };
    expect(compareCountries(fresh, stale)).toBeLessThan(0);
  });

  it("orders the owner's country cards from database statistics", async () => {
    const no = todayIn("Europe/Oslo");
    await DailyRegistrationSnapshot.updateOne({ countryCode: "NO", date: no, isDemo: false }, { $set: { newCompanies: 50, withEmail: 10, withPhone: 8, withDirectContact: 12 } }, { upsert: true });
    await DailyRegistrationSnapshot.updateOne({ countryCode: "IE", date: todayIn("Europe/Dublin"), isDemo: false }, { $set: { newCompanies: 20, withDirectContact: 0 } }, { upsert: true });
    await Country.updateMany({ code: { $in: ["NO", "IE"] } }, { $set: { lastSuccessAt: new Date(), lastSyncStatus: "SUCCESS" } });
    const cards = await listCountryCards(t.owner.actor);
    const codes = cards.map((c) => c.code);
    expect(codes.indexOf("NO")).toBeLessThan(codes.indexOf("IE"));
    expect(codes.indexOf("IE")).toBeLessThan(codes.indexOf("GB"));
    expect(codes.indexOf("GB")).toBeLessThan(codes.indexOf("SK"));
    expect(cards.find((c) => c.code === "NO")!.coverage).toMatchObject({ total: 50, withEmail: 10, withPhone: 8, withDirect: 12 });
  });
});

/* ───────────── Contact enrichment ───────────── */

describe("Website enrichment", () => {
  it("builds verified domain candidates per country (legal forms stripped, never stored unverified)", () => {
    expect(domainCandidates('SIA "Vastium"', "LV")).toEqual(["vastium.lv"]);
    expect(domainCandidates("Vita Karviná s.r.o.", "CZ")).toEqual(["vitakarvina.cz", "vita-karvina.cz"]);
    expect(domainCandidates("Alpenblick Beratung GmbH", "CH")).toEqual(["alpenblickberatung.ch", "alpenblick-beratung.ch"]);
    expect(domainCandidates("Fjord Bakeri AS", "NO")).toEqual(["fjordbakeri.no", "fjord-bakeri.no"]); // unchanged behaviour
    expect(identityEvidence("<p>SIA „Vastium“ — biroja pakalpojumi</p>", { companyName: 'SIA "Vastium"' })).toBe("EXACT_NAME");
  });

  it("reads structured data but ignores third parties (publisher / agency)", () => {
    const x = extractFromPage(SITES["https://alpenblickberatung.ch/kontakt"]!, "https://alpenblickberatung.ch/kontakt", "CH");
    expect(x.people).toEqual([{ name: "Anna Muster", role: "Geschäftsführerin", url: "https://alpenblickberatung.ch/kontakt" }]);
    expect(x.phones.map((p) => p.value)).not.toContain("+41315550123");
    expect(x.emails.map((e) => e.value)).not.toContain("hello@webagentur.example");
  });

  it("discovers the website, then finds email, phone and a contact person — each with its source", async () => {
    const c = await Company.create({ companyName: "Alpenblick Beratung GmbH", registrationNumber: "CHE-123.456.789", countryCode: "CH", source: "fixture", sourceId: "ch-1", registrationDay: todayIn("Europe/Zurich"), eventType: "NEW_ENTITY", firstSeenAt: new Date() });
    const r = await researchCompany(c._id, { manual: true });
    expect(r!.steps.find((s) => s.step === "website")!.status).toBe("done");
    const fresh = (await Company.findById(c._id).lean<CompanyDoc>())!;
    expect(fresh.website).toBe("https://alpenblickberatung.ch");
    expect(fresh.directContact).toMatchObject({ has: true, hasEmail: true, hasPhone: true });
    expect(fresh.email).toBe("info@alpenblickberatung.ch");
    expect(fresh.contactSources?.email?.kind).toBe("WEBSITE");
    expect(fresh.phone).toBe("+41441234567");
    expect(fresh.contactPerson).toMatchObject({ name: "Anna Muster", role: "Geschäftsführerin" });
    expect(fresh.contactSources?.contactPerson?.kind).toBe("WEBSITE");
    expect(fresh.registrationNumber).toBe("CHE-123.456.789"); // registry facts untouched
    const contacts = await Contact.find({ companyId: c._id }).lean<ContactDoc[]>();
    expect(contacts.filter((x) => x.value === "info@alpenblickberatung.ch")).toHaveLength(1); // duplicate on two pages → one record
    expect(contacts.find((x) => x.value === "noreply@alpenblickberatung.ch")?.usable).toBe(false); // invalid (no-reply) email
    expect(contacts.find((x) => x.value === "+41000000000")?.usable).toBe(false); // invalid phone
    expect(contacts.every((x) => x.source && x.sourceKind)).toBe(true);
  });

  it("says 'no public contact found' only after research ran, and never invents one", async () => {
    const c = await Company.create({ companyName: "Leer Handels AG", countryCode: "CH", source: "fixture", sourceId: "ch-2", website: "https://leer.ch", contactSources: { website: { kind: "REGISTRY", source: "Fixture" } }, registrationDay: todayIn("Europe/Zurich"), eventType: "NEW_ENTITY", firstSeenAt: new Date() });
    const row = (status: string, attempts: number) => ({ direct: { has: false, hasEmail: false, hasPhone: false, quality: 0, pendingVerification: false, formOnly: false }, research: { status, attempts }, eligibility: "NEEDS_REVIEW" }) as unknown as CompanyRow;
    expect(renderToStaticMarkup(<ContactStatus row={row("NOT_STARTED", 0)} />)).toContain("Research pending");
    const r = await researchCompany(c._id, { manual: true });
    expect(r!.status).toBe("NO_CONTACT_YET");
    const fresh = (await Company.findById(c._id).lean<CompanyDoc>())!;
    expect(fresh.directContact?.has).toBe(false);
    expect(fresh.email ?? null).toBeNull();
    expect(fresh.phone ?? null).toBeNull();
    expect(await Contact.countDocuments({ companyId: c._id, type: { $in: ["EMAIL", "PHONE"] } })).toBe(0);
    expect(renderToStaticMarkup(<ContactStatus row={row(r!.status, 1)} />)).toContain("No public contact found");
  });

  it("marks research unavailable when the website is down or times out, and schedules a retry", async () => {
    for (const host of ["down.ch", "slow.ch"]) {
      const c = await Company.create({ companyName: `Test ${host} AG`, countryCode: "CH", source: "fixture", sourceId: `ch-${host}`, website: `https://${host}`, contactSources: { website: { kind: "REGISTRY", source: "Fixture" } }, registrationDay: todayIn("Europe/Zurich"), eventType: "NEW_ENTITY", firstSeenAt: new Date() });
      const r = await researchCompany(c._id, { manual: true });
      expect(r!.status).toBe("RESEARCH_UNAVAILABLE");
      expect(r!.nextRetryAt).toBeInstanceOf(Date);
      expect(r!.steps.find((s) => s.step === "website")!.detail).toMatch(host === "slow.ch" ? /Timed out/ : /Unreachable/);
    }
  });
});

describe("Research retries", () => {
  it("queues companies whose retry is due, even when their last job finished", async () => {
    const due = await Company.create({ companyName: "Retry Due AS", countryCode: "NO", source: "fixture", sourceId: "r-1", registrationDay: todayIn("Europe/Oslo"), research: { status: "RETRY_SCHEDULED", attempts: 1, nextRetryAt: new Date(Date.now() - 60_000) } });
    const later = await Company.create({ companyName: "Retry Later AS", countryCode: "NO", source: "fixture", sourceId: "r-2", registrationDay: todayIn("Europe/Oslo"), research: { status: "RETRY_SCHEDULED", attempts: 1, nextRetryAt: new Date(Date.now() + 86_400_000) } });
    const done = await Company.create({ companyName: "Retry Exhausted AS", countryCode: "NO", source: "fixture", sourceId: "r-3", registrationDay: todayIn("Europe/Oslo"), research: { status: "EXHAUSTED", attempts: 6, nextRetryAt: new Date(Date.now() - 60_000) } });
    await Job.create({ type: "research", key: `research:${due._id}`, payload: { companyId: String(due._id) }, status: "DONE", runAt: new Date(Date.now() - 86_400_000) });
    expect(await scheduleDueRetries()).toBeGreaterThanOrEqual(1);
    expect((await Job.findOne({ key: `research:${due._id}` }).lean<{ status: string }>())!.status).toBe("QUEUED");
    expect(await Job.countDocuments({ key: { $in: [`research:${later._id}`, `research:${done._id}`] } })).toBe(0);
  });
});

/* ───────────── Company list ───────────── */

describe("Contactable companies first", () => {
  it("filters research-pending and verified contacts, and keeps direct contacts on top", async () => {
    const day = todayIn("Europe/Zurich");
    const base = { countryCode: "CH", source: "fixture", registrationDay: day, eventType: "NEW_ENTITY", firstSeenAt: new Date() };
    await Company.create({ ...base, companyName: "Zz Verified GmbH", sourceId: "l-1", directContact: { has: true, hasEmail: true, emailVerification: "DELIVERABLE", quality: 80 }, research: { status: "CONTACTS_FOUND", attempts: 1 } });
    await Company.create({ ...base, companyName: "Aa Pending GmbH", sourceId: "l-2", research: { status: "NOT_STARTED", attempts: 0 } });
    const all = await listCompanies(t.owner.actor, { country: "CH", range: "today", q: "GmbH" });
    expect(all.items[0]!.directContact?.has).toBe(true);
    const verified = await listCompanies(t.owner.actor, { country: "CH", range: "today", contact: "verified" });
    expect(verified.items.map((c) => c.companyName)).toEqual(["Zz Verified GmbH"]);
    const pending = await listCompanies(t.owner.actor, { country: "CH", range: "today", contact: "researching", q: "Pending" });
    expect(pending.items.map((c) => c.companyName)).toEqual(["Aa Pending GmbH"]);
  });
});

/* ───────────── Owner-only ───────────── */

describe("Company Intelligence stays owner-only", () => {
  it("refuses country data, company / contact data, enrichment, export and email to admins and staff", async () => {
    const c = await Company.findOne({ countryCode: "FR" }).lean<CompanyDoc>();
    for (const who of [t.admin.actor, t.staff.actor, t.clientA.actor]) {
      await expectRejects(listCountryCards(who), 403);
      await expectRejects(listCompanies(who, { country: "FR" }), 403);
      await expectRejects(getCompanyDetail(who, String(c!._id)), 403);
      await expectRejects(exportCompanies(who, { country: "FR" }), 403);
      await expectRejects(runEnrichment(who, String(c!._id)), 403);
      await expectRejects(sendEmail(who, { to: "someone@company.example", subject: "Hello", body: "Hi", idempotencyKey: `k-${who.id}` }), 403);
    }
    expect((await listCountryCards(t.owner.actor)).length).toBeGreaterThan(0);
  });
});
