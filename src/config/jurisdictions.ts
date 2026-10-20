/**
 * European jurisdiction catalogue — research status for every jurisdiction.
 *
 * A jurisdiction listed here is NOT an integration. `state` is the honest
 * baseline; runtime status (credentials present, provider errors) refines it.
 * `evidence` records how far verification has actually gone:
 *   DOCUMENTED → CONFIGURED → AUTHENTICATED → REAL_DATA_TESTED → FRESHNESS_MEASURED
 * Text marked "Not yet verified" has not been checked against official documentation.
 *
 * Scope decisions: jurisdictions needing legal / sanctions / transcontinental review
 * are listed but disabled until the Owner decides (Settings → Countries).
 */
export type IntegrationState = "CONNECTED" | "LOOKUP_ONLY" | "NEEDS_CREDENTIALS" | "NEEDS_APPROVAL" | "UNDER_RESEARCH" | "PROVIDER_ERROR" | "NO_VERIFIED_FEED";
export type EvidenceLevel = "NONE" | "DOCUMENTED" | "CONFIGURED" | "AUTHENTICATED" | "REAL_DATA_TESTED" | "FRESHNESS_MEASURED";
export type ScopeDecision = "IN_SCOPE" | "OWNER_REVIEW" | "TRANSCONTINENTAL_REVIEW" | "RESTRICTED_REVIEW" | "NOT_APPLICABLE";
export type JurisdictionGroup = "EU" | "EEA_EFTA" | "UK" | "CROWN_DEPENDENCY" | "WESTERN_BALKANS" | "MICROSTATE" | "EASTERN_EUROPE" | "TRANSCONTINENTAL";

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  CONNECTED: "Connected",
  LOOKUP_ONLY: "Lookup only",
  NEEDS_CREDENTIALS: "Needs credentials",
  NEEDS_APPROVAL: "Needs approval",
  UNDER_RESEARCH: "Under research",
  PROVIDER_ERROR: "Provider error",
  NO_VERIFIED_FEED: "No verified feed found",
};

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  NONE: "Not researched",
  DOCUMENTED: "Documented",
  CONFIGURED: "Configured",
  AUTHENTICATED: "Authenticated",
  REAL_DATA_TESTED: "Real-data tested",
  FRESHNESS_MEASURED: "Freshness measured",
};

export type Jurisdiction = {
  code: string;
  name: string;
  adjective: string;
  flag: string;
  group: JurisdictionGroup;
  timezone: string;
  languages: string[];
  registry: { name: string; url: string };
  registrationNumberLabel: string;
  /** API / feed that can (or might) deliver new registrations. */
  feed: string;
  registrationDateMeaning: string;
  entities: string;
  contactFields: string;
  updateFrequency: string;
  access: string;
  permittedUse: string;
  state: IntegrationState;
  evidence: EvidenceLevel;
  /** Implemented provider adapters (first = default). */
  providers: string[];
  scope: ScopeDecision;
  /** Enabled by default in the dashboard. */
  defaultEnabled: boolean;
  notes?: string;
  sources?: string[];
};

const NV = "Not yet verified";

function j(x: Omit<Jurisdiction, "defaultEnabled" | "scope" | "evidence" | "providers"> & Partial<Pick<Jurisdiction, "defaultEnabled" | "scope" | "evidence" | "providers">>): Jurisdiction {
  return { defaultEnabled: false, scope: "IN_SCOPE", evidence: "NONE", providers: [], ...x };
}

/** Default text for jurisdictions not yet researched in depth. */
function research(code: string, name: string, adjective: string, flag: string, group: JurisdictionGroup, timezone: string, languages: string[], registry: string, url: string, numberLabel: string, extra: Partial<Jurisdiction> = {}): Jurisdiction {
  return j({
    code,
    name,
    adjective,
    flag,
    group,
    timezone,
    languages,
    registry: { name: registry, url },
    registrationNumberLabel: numberLabel,
    feed: NV,
    registrationDateMeaning: NV,
    entities: NV,
    contactFields: NV,
    updateFrequency: NV,
    access: NV,
    permittedUse: NV,
    state: "UNDER_RESEARCH",
    ...extra,
  });
}

export const JURISDICTIONS: Jurisdiction[] = [
  // ───────────── Implemented / documented ─────────────
  j({
    code: "NO", name: "Norway", adjective: "Norwegian", flag: "🇳🇴", group: "EEA_EFTA", timezone: "Europe/Oslo", languages: ["no", "en"],
    registry: { name: "Brønnøysundregistrene — Enhetsregisteret", url: "https://www.brreg.no" },
    registrationNumberLabel: "Organisation number",
    feed: "Open REST API: /enheter (search by registration date), /enheter/{orgnr}, /oppdateringer/enheter (incremental change feed: Ny / Endring / Sletting)",
    registrationDateMeaning: "registreringsdatoEnhetsregisteret — date the legal entity was entered in the Central Coordinating Register",
    entities: "Legal entities (enheter). Subunits (underenheter) are a separate endpoint and are not imported as new companies.",
    contactFields: "epostadresse, telefon, mobil, hjemmeside — published when the entity has registered them",
    updateFrequency: "Search service real-time; update feed measured (see Data Sources); bulk files daily",
    access: "Open, no key (NLOD licence)",
    permittedUse: "Norwegian Licence for Open Government Data (NLOD). Marketing use must still respect the Reservasjonsregisteret / ePrivacy rules.",
    state: "CONNECTED", evidence: "FRESHNESS_MEASURED", providers: ["brreg"], defaultEnabled: true,
    sources: ["https://data.brreg.no/enhetsregisteret/api/docs/index.html"],
  }),
  j({
    code: "FI", name: "Finland", adjective: "Finnish", flag: "🇫🇮", group: "EU", timezone: "Europe/Helsinki", languages: ["fi", "sv", "en"],
    registry: { name: "Finnish Patent and Registration Office (PRH) — YTJ", url: "https://www.prh.fi" },
    registrationNumberLabel: "Business ID (Y-tunnus)",
    feed: "Open REST API v3 /companies with registrationDateStart/End",
    registrationDateMeaning: "Trade register registration date of the company",
    entities: "Companies in the trade register (limited companies, cooperatives, housing companies, associations …)",
    contactFields: "Website only. PRH open data excludes email and phone numbers.",
    updateFrequency: "Daily",
    access: "Open, no key",
    permittedUse: "PRH open data licence (CC BY 4.0). Contacts must come from other sources.",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["prh"], defaultEnabled: true,
    sources: ["https://avoindata.prh.fi/en/ytj/swagger-ui", "https://www.prh.fi/en/companiesandorganisations/tietopalvelut/prhopendata.html"],
  }),
  j({
    code: "IE", name: "Ireland", adjective: "Irish", flag: "🇮🇪", group: "EU", timezone: "Europe/Dublin", languages: ["en"],
    registry: { name: "Companies Registration Office (CRO)", url: "https://cro.ie" },
    registrationNumberLabel: "Company number",
    feed: "CRO open data (CKAN) — Company Records dataset, queryable via datastore_search_sql by company_reg_date",
    registrationDateMeaning: "company_reg_date — date the company was registered with the CRO",
    entities: "Companies (LTD, DAC, PLC, CLG, …). Business names are a separate register and not included.",
    contactFields: "None (address only)",
    updateFrequency: "Publisher states daily; observed resource modification lag is shown on Data Sources",
    access: "Open, no key",
    permittedUse: "CC BY 4.0 with attribution to the CRO",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["cro"], defaultEnabled: true,
    sources: ["https://opendata.cro.ie/dataset/companies"],
  }),
  j({
    code: "GB", name: "United Kingdom", adjective: "UK", flag: "🇬🇧", group: "UK", timezone: "Europe/London", languages: ["en"],
    registry: { name: "Companies House", url: "https://find-and-update.company-information.service.gov.uk" },
    registrationNumberLabel: "Company number",
    feed: "REST: /advanced-search/companies (incorporated_from/to), /company/{number}; Streaming: stream.companieshouse.gov.uk/companies (persistent, timepoint resume)",
    registrationDateMeaning: "date_of_creation — incorporation date",
    entities: "Companies, LLPs, LPs and other registered entities",
    contactFields: "None. The public company profile has no email or phone fields.",
    updateFrequency: "REST: current register data. Streaming: change events as they are published.",
    access: "Free API keys — separate REST and Streaming applications",
    permittedUse: "Open Government Licence. B2B electronic marketing to corporate subscribers is regulated by PECR; sole traders and partnerships are treated like individuals.",
    state: "NEEDS_CREDENTIALS", evidence: "DOCUMENTED", providers: ["companies-house"], defaultEnabled: true,
    sources: ["https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview", "https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/"],
  }),
  j({
    code: "FR", name: "France", adjective: "French", flag: "🇫🇷", group: "EU", timezone: "Europe/Paris", languages: ["fr", "en"],
    registry: { name: "BODACC (DILA) / INSEE — Sirene", url: "https://www.bodacc.fr" },
    registrationNumberLabel: "SIREN",
    feed: "Default: BODACC A “Créations” open data (DILA Opendatasoft API, no key) — new RCS registrations by publication date. Alternative: API Sirene 3.11 /siret with q=dateCreationUniteLegale:[D TO D] (provider “insee-sirene”, free INSEE key)",
    registrationDateMeaning: "BODACC: acte.dateImmatriculation — RCS registration date stated in the notice (notices without it are skipped). Sirene: dateCreationUniteLegale — legal unit creation date",
    entities: "Legal persons registered at the RCS (SAS, SARL, SCI, SA …). Sole traders excluded by default (FRANCE_INCLUDE_SOLE_TRADERS)",
    contactFields: "No email, phone or website. BODACC names the officers (Président, Gérant …) — kept as registry contact person",
    updateFrequency: "Daily (BODACC A publication days); registrations appear a few days after the greffe records them",
    access: "BODACC: open, no key. Sirene: free API key (INSEE API portal)",
    permittedUse: "Licence Ouverte / Etalab 2.0. Partially diffusible Sirene units must not be used. B2B prospecting must respect CNIL rules (opposition right, information).",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["bodacc", "insee-sirene"], defaultEnabled: true,
    notes: "≈ 700–800 legal-person creation notices per publication day; ≈ 80 % state an immatriculation date (verified 2026-10).",
    sources: ["https://bodacc-datadila.opendatasoft.com/explore/dataset/annonces-commerciales/information/", "https://www.insee.fr/fr/information/3591226", "https://portail-api.insee.fr/"],
  }),
  j({
    code: "NL", name: "Netherlands", adjective: "Dutch", flag: "🇳🇱", group: "EU", timezone: "Europe/Amsterdam", languages: ["nl", "en"],
    registry: { name: "Kamer van Koophandel (KVK) — Handelsregister", url: "https://www.kvk.nl" },
    registrationNumberLabel: "KVK number",
    feed: "KVK Mutatieservice (subscription signals: SignaalNieuweInschrijving with aanleiding/startdatum) + Basisprofiel API for name, SBI and address",
    registrationDateMeaning: "startdatum of the new registration signal (YYYYMMDD); signal registratieTijdstip is the publication time",
    entities: "Registrations in the Handelsregister (companies and sole proprietorships); reason codes distinguish new formations from continuations, mergers and relocations",
    contactFields: "None in signals or Basisprofiel. indNonMailing marks companies that object to unsolicited mail.",
    updateFrequency: "Near real-time — KVK documents signal delivery within 15 minutes of registration",
    access: "Paid KVK API subscription + API key (apikey header)",
    permittedUse: "KVK terms; respect indNonMailing (non-mailing indicator)",
    state: "NEEDS_CREDENTIALS", evidence: "DOCUMENTED", providers: ["kvk"], defaultEnabled: true,
    notes: "Adapter verified against KVK's public test environment (fictional test data).",
    sources: ["https://developers.kvk.nl/documentation/mutatieservice-api"],
  }),
  j({
    code: "EE", name: "Estonia", adjective: "Estonian", flag: "🇪🇪", group: "EU", timezone: "Europe/Tallinn", languages: ["et", "en"],
    registry: { name: "e-Business Register (RIK)", url: "https://ariregister.rik.ee" },
    registrationNumberLabel: "Registry code",
    feed: "Open data: daily “Basic data” file ettevotja_rekvisiidid__lihtandmed.csv.zip (no account). Alternative with contacts: XML/SOAP services ettevotjaMuudatusedTasuline_v1 + detailandmed_v2 (provider “rik”, needs a RIK agreement)",
    registrationDateMeaning: "ettevotja_esmakande_kpv — date of first entry in the register",
    entities: "Entities currently in the register (companies, partnerships, non-profits, branches). Sole traders (FIE) excluded unless ESTONIA_INCLUDE_SOLE_TRADERS=true",
    contactFields: "None in the open-data basic file. The contract XML services (provider “rik”) return EMAIL, TEL, MOB, WWW",
    updateFrequency: "Daily (file regenerated each morning, Europe/Tallinn)",
    access: "Open data: free download, CC BY 4.0, no account. XML services: RIK agreement + username/password",
    permittedUse: "CC BY 4.0 with attribution to RIK; GDPR applies to any personal data",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["rik-open-data", "rik"], defaultEnabled: true,
    sources: ["https://avaandmed.ariregister.rik.ee/en/downloading-open-data", "https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services"],
  }),
  j({
    code: "DE", name: "Germany", adjective: "German", flag: "🇩🇪", group: "EU", timezone: "Europe/Berlin", languages: ["de", "en"],
    registry: { name: "Handelsregister (via OpenRegister, commercial)", url: "https://www.handelsregister.de" },
    registrationNumberLabel: "Register number (court + HRA/HRB)",
    feed: "No official API. Commercial: OpenRegister POST /v1/search/company with incorporated_at min/max filter",
    registrationDateMeaning: "incorporated_at as reported by OpenRegister — publication delay to be measured",
    entities: "Handelsregister entities (GmbH, UG, AG, KG, …)",
    contactFields: "Not evidenced in OpenRegister search results — contacts come from research",
    updateFrequency: "Provider states new companies within ~24 h — not yet measured",
    access: "Commercial API key (OpenRegister)",
    permittedUse: "Per OpenRegister terms",
    state: "NEEDS_CREDENTIALS", evidence: "DOCUMENTED", providers: ["openregister"], defaultEnabled: true,
    sources: ["https://docs.openregister.de/endpoint/filter-company"],
  }),
  j({
    code: "DK", name: "Denmark", adjective: "Danish", flag: "🇩🇰", group: "EU", timezone: "Europe/Copenhagen", languages: ["da", "en"],
    registry: { name: "CVR — Erhvervsstyrelsen", url: "https://datacvr.virk.dk" },
    registrationNumberLabel: "CVR number",
    feed: "CVR system-to-system Elasticsearch (credentials). Datafordeler CVR (REST/GraphQL) — endpoint contract not yet verified.",
    registrationDateMeaning: "Start date (livsforloeb gyldigFra / stiftelsesDato)",
    entities: "CVR entities (companies, sole proprietorships)",
    contactFields: "Email, phone, website when registered; secret values skipped",
    updateFrequency: "Continuously updated (to be measured)",
    access: "Credentials from Erhvervsstyrelsen; ordinary CVR entities on Datafordeler need no register approval (CVRPerson does)",
    permittedUse: "Reklamebeskyttede companies must not receive marketing",
    state: "NEEDS_CREDENTIALS", evidence: "DOCUMENTED", providers: ["cvr"], defaultEnabled: true,
    sources: ["https://datafordeler.dk/vejledning/brugeradgang/anmodning-om-adgang/det-centrale-virksomhedsregister-cvr/"],
  }),
  j({
    code: "SE", name: "Sweden", adjective: "Swedish", flag: "🇸🇪", group: "EU", timezone: "Europe/Stockholm", languages: ["sv", "en"],
    registry: { name: "SCB Företagsregistret / Bolagsverket", url: "https://www.scb.se" },
    registrationNumberLabel: "Organisationsnummer",
    feed: "SCB free Business Register API (privateapi.scb.se/nv0101/v1/sokpavar, client certificate, ≤2 000 rows/call, pagination). Bolagsverket värdefulla datamängder: lookup by organisation number only.",
    registrationDateMeaning: NV + " (SCB field contract is only available after access is granted)",
    entities: "Companies and workplaces in SCB's Business Register",
    contactFields: NV,
    updateFrequency: "Nightly refresh (not every field nightly); no changes-only function in the free API",
    access: "Certificate + password from SCB (scbforetag@scb.se) after accepting terms",
    permittedUse: NV,
    state: "NEEDS_APPROVAL", evidence: "DOCUMENTED", providers: ["bolagsverket"], defaultEnabled: true,
    notes: "No adapter yet: the request/response schema is behind the certificate. The API host was unreachable from the test environment.",
    sources: ["https://www.scb.se/vara-tjanster/bestall-data-och-statistik/foretagsregistret/avgiftsfria-uppgifter-i-foretagsregistret/"],
  }),
  research("SK", "Slovakia", "Slovak", "🇸🇰", "EU", "Europe/Bratislava", ["sk", "en"], "Register of Legal Entities (RPO) — Statistical Office", "https://rpo.statistics.sk", "IČO", {
    feed: "RPO REST API (api.statistics.sk/rpo/v1) and incremental files — documented on Apiary",
    updateFrequency: "Daily (per publisher)",
    access: "Open",
    evidence: "DOCUMENTED",
    notes: "Re-tested 2026-10-18: lookups by name / IČO answer within seconds and the establishmentAfter/Before filter is honoured, but a date-only search (one day, all of Slovakia) did not answer within 90 s. No adapter until a date window can be fetched reliably (candidate: RPO incremental files).",
    sources: ["https://susrrpo.docs.apiary.io/"],
  }),

  // ───────────── EU — under research ─────────────
  research("AT", "Austria", "Austrian", "🇦🇹", "EU", "Europe/Vienna", ["de", "en"], "Firmenbuch (Federal Ministry of Justice)", "https://www.justiz.gv.at", "Firmenbuchnummer", { access: "Paid access via clearing agencies (Verrechnungsstellen); free public search on justizonline is not an API — HVD open-data options not yet verified", notes: "No free automated source verified. Not scraped." }),
  research("BE", "Belgium", "Belgian", "🇧🇪", "EU", "Europe/Brussels", ["nl", "fr", "de", "en"], "Crossroads Bank for Enterprises (KBO/BCE)", "https://kbopub.economie.fgov.be", "Enterprise number", { feed: "KBO Open Data ZIP files (enterprise, establishment, contact.csv with TEL / EMAIL / WEB) — download requires a free user account; update cadence not yet verified", access: "Free account (KBO Open Data registration, licence acceptance)", contactFields: "contact.csv publishes phone, email and website where the enterprise registered them (not yet verified)", notes: "Promising (free, with contacts) but the download sits behind a login. No adapter yet; it needs the Owner's free KBO Open Data account and a verified download contract." }),
  research("BG", "Bulgaria", "Bulgarian", "🇧🇬", "EU", "Europe/Sofia", ["bg", "en"], "Commercial Register (Registry Agency)", "https://portal.registryagency.bg", "UIC (EIK)", { notes: "Portal API answers, but no documented, permitted date-window feed was found (2026-10-18)." }),
  research("HR", "Croatia", "Croatian", "🇭🇷", "EU", "Europe/Zagreb", ["hr", "en"], "Court Register (Sudski registar)", "https://sudreg.pravosudje.hr", "OIB / MBS", { feed: "Sudski registar open-data API (sudreg-data.gov.hr, OpenAPI published) — OAuth client credentials", access: "Free registration for API client credentials (not yet obtained)", evidence: "DOCUMENTED", notes: "API documentation reachable (2026-10-18). Needs the Owner's free client registration; date-window contract not yet verified, so no adapter." }),
  research("CY", "Cyprus", "Cypriot", "🇨🇾", "EU", "Asia/Nicosia", ["el", "en"], "Department of Registrar of Companies", "https://efiling.drcor.mcit.gov.cy", "Registration number", { feed: "Candidate: registered-organisations dataset on data.gov.cy (periodic CSV)", notes: "2026-10-18: the data.gov.cy CKAN search endpoint returned 404; dataset and cadence not verified." }),
  j({
    code: "CZ", name: "Czechia", adjective: "Czech", flag: "🇨🇿", group: "EU", timezone: "Europe/Prague", languages: ["cs", "en"],
    registry: { name: "Public Register (Veřejný rejstřík) via ARES", url: "https://ares.gov.cz" },
    registrationNumberLabel: "IČO",
    feed: "ARES REST API: notification batches of the public register (/ekonomicke-subjekty-notifikace, change type INS) + /ekonomicke-subjekty-vr/{ico} for each inserted entity",
    registrationDateMeaning: "datumZapisu — date of entry in the public register (the day a company comes into existence)",
    entities: "Commercial forms: s.r.o., a.s., v.o.s., k.s., cooperatives, European forms; foreign branches as BRANCH. Associations, foundations and other non-profits excluded unless CZECHIA_INCLUDE_NON_PROFITS=true",
    contactFields: "No email, phone or website. Statutory body members (jednatel …) — name and role kept as registry contact person",
    updateFrequency: "Daily batches (working days); entities appear 1–3 days after the court registers them",
    access: "Open, no key",
    permittedUse: "Public register data (Act 304/2013 Coll.), free reuse; GDPR applies to officers' personal data",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["ares-cz"], defaultEnabled: true,
    notes: "≈ 100–250 new business entities per working day (verified 2026-10). The plain ARES search has no date filter — only the notification batches identify new entries.",
    sources: ["https://ares.gov.cz/stranky/vyvojar-info", "https://ares.gov.cz/swagger-ui/"],
  }),
  research("GR", "Greece", "Greek", "🇬🇷", "EU", "Europe/Athens", ["el", "en"], "General Commercial Registry (GEMI)", "https://www.businessportal.gr", "GEMI number"),
  research("HU", "Hungary", "Hungarian", "🇭🇺", "EU", "Europe/Budapest", ["hu", "en"], "Company Information Service (Céginformációs Szolgálat)", "https://www.e-cegjegyzek.hu", "Company registration number"),
  research("IT", "Italy", "Italian", "🇮🇹", "EU", "Europe/Rome", ["it", "en"], "Registro delle Imprese (InfoCamere)", "https://www.registroimprese.it", "REA / Codice fiscale", { access: "Paid (InfoCamere) — not yet verified" }),
  j({
    code: "LV", name: "Latvia", adjective: "Latvian", flag: "🇱🇻", group: "EU", timezone: "Europe/Riga", languages: ["lv", "en"],
    registry: { name: "Register of Enterprises (Uzņēmumu reģistrs)", url: "https://www.ur.gov.lv" },
    registrationNumberLabel: "Registration number",
    feed: "Open data on data.gov.lv: daily register.csv (EU High-Value Dataset, Implementing Regulation (EU) 2023/138)",
    registrationDateMeaning: "registered — date the entity was entered in the register",
    entities: "Commercial Register (K: SIA, AS, IK, branches …) and Enterprise Register (U: farms, other undertakings). Associations, foundations, media and other registers are not imported",
    contactFields: "None (legal address only)",
    updateFrequency: "Daily (file regenerated each evening)",
    access: "Open, no key",
    permittedUse: "CC0 1.0",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["ur-lv"], defaultEnabled: true,
    sources: ["https://data.gov.lv/dati/eng/dataset/uz"],
  }),
  research("LT", "Lithuania", "Lithuanian", "🇱🇹", "EU", "Europe/Vilnius", ["lt", "en"], "Register of Legal Entities (Registrų centras)", "https://www.registrucentras.lt", "Legal entity code", { feed: "Registrų centras open-data files (registered legal entities CSV) / get.data.gov.lt", evidence: "DOCUMENTED", notes: "2026-10-18: the open-data download answered 403 to automated clients and get.data.gov.lt returned 500. Access controls are not bypassed — no adapter." }),
  research("LU", "Luxembourg", "Luxembourg", "🇱🇺", "EU", "Europe/Luxembourg", ["fr", "de", "en"], "Luxembourg Business Registers (LBR/RCS)", "https://www.lbr.lu", "RCS number"),
  research("MT", "Malta", "Maltese", "🇲🇹", "EU", "Europe/Malta", ["en", "mt"], "Malta Business Registry", "https://mbr.mt", "Company number"),
  research("PL", "Poland", "Polish", "🇵🇱", "EU", "Europe/Warsaw", ["pl", "en"], "National Court Register (KRS) / CEIDG", "https://ekrs.ms.gov.pl", "KRS / NIP", { feed: "KRS open API (api-krs.ms.gov.pl): /Biuletyn/{date} lists KRS numbers with entries that day, /OdpisAktualny/{krs} returns the extract (registration date, address, board, email / website fields). CEIDG API (sole traders) requires a token", access: "Open, no key (KRS)", evidence: "DOCUMENTED", notes: "2026-10-18: the KRS API returned a ‘Przerwa techniczna’ (maintenance) page, so response contracts could not be verified. The bulletin lists every changed entity, so one extract call per entity is needed to find new registrations — an adapter must be rate-limited carefully." }),
  research("PT", "Portugal", "Portuguese", "🇵🇹", "EU", "Europe/Lisbon", ["pt", "en"], "Registo Comercial (IRN)", "https://www.irn.mj.pt", "NIPC"),
  research("RO", "Romania", "Romanian", "🇷🇴", "EU", "Europe/Bucharest", ["ro", "en"], "National Trade Register Office (ONRC)", "https://www.onrc.ro", "CUI / Registration number"),
  research("SI", "Slovenia", "Slovenian", "🇸🇮", "EU", "Europe/Ljubljana", ["sl", "en"], "AJPES — Business Register", "https://www.ajpes.si", "Registration number"),
  research("ES", "Spain", "Spanish", "🇪🇸", "EU", "Europe/Madrid", ["es", "en"], "Registro Mercantil / BORME", "https://www.boe.es", "NIF", { feed: "BORME daily summary (BOE open-data API) — Section A ‘Actos inscritos’ (constituciones) are published as PDF per province", access: "Open, no key", evidence: "DOCUMENTED", notes: "Incorporations are only available as PDF text; no structured feed verified. No adapter." }),

  // ───────────── EEA / EFTA ─────────────
  research("IS", "Iceland", "Icelandic", "🇮🇸", "EEA_EFTA", "Atlantic/Reykjavik", ["is", "en"], "Skatturinn — Register of Enterprises (Fyrirtækjaskrá)", "https://www.skatturinn.is", "Kennitala"),
  research("LI", "Liechtenstein", "Liechtenstein", "🇱🇮", "EEA_EFTA", "Europe/Vaduz", ["de", "en"], "Handelsregister Liechtenstein", "https://www.oera.li", "Register number"),
  j({
    code: "CH", name: "Switzerland", adjective: "Swiss", flag: "🇨🇭", group: "EEA_EFTA", timezone: "Europe/Zurich", languages: ["de", "fr", "it", "en"],
    registry: { name: "Commercial registers / SHAB (FOSC)", url: "https://www.shab.ch" },
    registrationNumberLabel: "UID (CHE)",
    feed: "Official Gazettes Portal API (SECO): SHAB publications of sub-rubric HR01 “Neueintragung” (new entries), structured XML per publication",
    registrationDateMeaning: "journalDate — commercial register journal date (entry legally effective); published in SHAB 1–5 working days later",
    entities: "New commercial-register entries (GmbH, AG, cooperatives, partnerships, associations, foundations, branches). Sole proprietorships excluded unless SWITZERLAND_INCLUDE_SOLE_TRADERS=true",
    contactFields: "None (legal address and purpose only)",
    updateFrequency: "Daily (working days)",
    access: "Open, no key (“The API is freely accessible for anyone to use”)",
    permittedUse: "Public official publications; the operator guarantees only the signed PDF as legally binding",
    state: "CONNECTED", evidence: "REAL_DATA_TESTED", providers: ["shab"], defaultEnabled: true,
    sources: ["https://amtsblattportal.ch/docs/api/"],
  }),

  // ───────────── Crown dependencies & territories ─────────────
  research("JE", "Jersey", "Jersey", "🇯🇪", "CROWN_DEPENDENCY", "Europe/Jersey", ["en"], "Jersey Financial Services Commission — Registry", "https://www.jerseyfsc.org", "Registration number", { scope: "OWNER_REVIEW" }),
  research("GG", "Guernsey", "Guernsey", "🇬🇬", "CROWN_DEPENDENCY", "Europe/Guernsey", ["en"], "Guernsey Registry", "https://www.guernseyregistry.com", "Registration number", { scope: "OWNER_REVIEW" }),
  research("IM", "Isle of Man", "Manx", "🇮🇲", "CROWN_DEPENDENCY", "Europe/Isle_of_Man", ["en"], "Isle of Man Companies Registry", "https://www.iomcompanies.com", "Company number", { scope: "OWNER_REVIEW" }),
  research("GI", "Gibraltar", "Gibraltar", "🇬🇮", "CROWN_DEPENDENCY", "Europe/Gibraltar", ["en"], "Companies House Gibraltar", "https://www.companieshouse.gi", "Company number", { scope: "OWNER_REVIEW" }),
  research("FO", "Faroe Islands", "Faroese", "🇫🇴", "CROWN_DEPENDENCY", "Atlantic/Faroe", ["fo", "da"], "Skráseting Føroya", "https://www.skraseting.fo", "V-tal", { scope: "OWNER_REVIEW" }),

  // ───────────── Western Balkans ─────────────
  research("AL", "Albania", "Albanian", "🇦🇱", "WESTERN_BALKANS", "Europe/Tirane", ["sq", "en"], "National Business Center (QKB)", "https://qkb.gov.al", "NIPT"),
  research("BA", "Bosnia and Herzegovina", "Bosnian", "🇧🇦", "WESTERN_BALKANS", "Europe/Sarajevo", ["bs", "hr", "sr", "en"], "Court registers (entity-level)", "https://bizreg.pravosudje.ba", "Registration number", { notes: "Registration is split between entity-level registers." }),
  research("ME", "Montenegro", "Montenegrin", "🇲🇪", "WESTERN_BALKANS", "Europe/Podgorica", ["sr", "en"], "Central Register of Business Entities (CRPS)", "https://www.crps.me", "Registration number"),
  research("MK", "North Macedonia", "North Macedonian", "🇲🇰", "WESTERN_BALKANS", "Europe/Skopje", ["mk", "en"], "Central Registry", "https://www.crm.com.mk", "EMBS"),
  research("RS", "Serbia", "Serbian", "🇷🇸", "WESTERN_BALKANS", "Europe/Belgrade", ["sr", "en"], "Serbian Business Registers Agency (APR)", "https://www.apr.gov.rs", "Matični broj"),
  research("XK", "Kosovo", "Kosovar", "🇽🇰", "WESTERN_BALKANS", "Europe/Belgrade", ["sq", "sr", "en"], "Kosovo Business Registration Agency (ARBK)", "https://arbk.rks-gov.net", "Registration number"),

  // ───────────── Microstates ─────────────
  research("AD", "Andorra", "Andorran", "🇦🇩", "MICROSTATE", "Europe/Andorra", ["ca", "es", "fr"], "Registre de Societats", "https://www.govern.ad", "NRT"),
  research("MC", "Monaco", "Monegasque", "🇲🇨", "MICROSTATE", "Europe/Monaco", ["fr", "en"], "Répertoire du Commerce et de l'Industrie (RCI)", "https://www.monacodigital.mc", "RCI number"),
  research("SM", "San Marino", "Sammarinese", "🇸🇲", "MICROSTATE", "Europe/San_Marino", ["it"], "Registro delle Società", "https://www.tribunale.sm", "COE"),
  j({
    code: "VA", name: "Vatican City", adjective: "Vatican", flag: "🇻🇦", group: "MICROSTATE", timezone: "Europe/Vatican", languages: ["it", "la"],
    registry: { name: "No commercial company register", url: "https://www.vatican.va" }, registrationNumberLabel: "—",
    feed: "None", registrationDateMeaning: "—", entities: "No private commercial company formation", contactFields: "—", updateFrequency: "—", access: "—", permittedUse: "—",
    state: "NO_VERIFIED_FEED", scope: "NOT_APPLICABLE",
  }),

  // ───────────── Eastern Europe (owner / legal review) ─────────────
  research("MD", "Moldova", "Moldovan", "🇲🇩", "EASTERN_EUROPE", "Europe/Chisinau", ["ro", "en"], "Public Services Agency (ASP) — State Register of Legal Entities", "https://asp.gov.md", "IDNO", { scope: "OWNER_REVIEW", feed: "Open data on date.gov.md — cadence not yet verified" }),
  research("UA", "Ukraine", "Ukrainian", "🇺🇦", "EASTERN_EUROPE", "Europe/Kyiv", ["uk", "en"], "Unified State Register (USR)", "https://usr.minjust.gov.ua", "EDRPOU", { scope: "OWNER_REVIEW", notes: "Some register data access has been restricted under martial law — legal review required." }),
  research("BY", "Belarus", "Belarusian", "🇧🇾", "EASTERN_EUROPE", "Europe/Minsk", ["be", "ru"], "Unified State Register of Legal Entities (EGR)", "https://egr.gov.by", "UNP", { scope: "RESTRICTED_REVIEW", notes: "Sanctions / legal review required before any use." }),

  // ───────────── Transcontinental (explicit owner decision) ─────────────
  research("RU", "Russia", "Russian", "🇷🇺", "TRANSCONTINENTAL", "Europe/Moscow", ["ru"], "EGRUL (Federal Tax Service)", "https://egrul.nalog.ru", "OGRN", { scope: "RESTRICTED_REVIEW", notes: "Transcontinental; sanctions / legal review required." }),
  research("TR", "Türkiye", "Turkish", "🇹🇷", "TRANSCONTINENTAL", "Europe/Istanbul", ["tr", "en"], "Trade Registry Gazette / MERSIS", "https://www.ticaretsicil.gov.tr", "MERSIS number", { scope: "TRANSCONTINENTAL_REVIEW" }),
  research("GE", "Georgia", "Georgian", "🇬🇪", "TRANSCONTINENTAL", "Asia/Tbilisi", ["ka", "en"], "National Agency of Public Registry (NAPR)", "https://napr.gov.ge", "Identification code", { scope: "TRANSCONTINENTAL_REVIEW" }),
  research("AM", "Armenia", "Armenian", "🇦🇲", "TRANSCONTINENTAL", "Asia/Yerevan", ["hy", "en"], "State Register of Legal Entities", "https://www.e-register.am", "Registration number", { scope: "TRANSCONTINENTAL_REVIEW" }),
  research("AZ", "Azerbaijan", "Azerbaijani", "🇦🇿", "TRANSCONTINENTAL", "Asia/Baku", ["az", "en"], "State Tax Service — register", "https://www.taxes.gov.az", "VÖEN", { scope: "TRANSCONTINENTAL_REVIEW" }),
  research("KZ", "Kazakhstan", "Kazakh", "🇰🇿", "TRANSCONTINENTAL", "Asia/Almaty", ["kk", "ru", "en"], "National Register of Business Identification Numbers", "https://stat.gov.kz", "BIN", { scope: "TRANSCONTINENTAL_REVIEW" }),
];

export function getJurisdiction(code: string | undefined | null) {
  if (!code) return undefined;
  return JURISDICTIONS.find((x) => x.code === code.toUpperCase());
}
