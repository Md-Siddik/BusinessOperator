# Country business-data status — briefing for an AI assistant

_Snapshot taken 11 Oct 2026 from the live database (MongoDB Atlas, database `ExploreTechify`) and the source code._

## 1. What I need help with

I run **ExploreTechify**, a Next.js app that lists **newly registered companies** in every European country, so I can contact new businesses and offer them services (websites, email, IT support).

Right now only **3 of 56 countries** show any data. I want new registrations from as many countries as possible. Please help me:

1. For each country below, work out the **fastest legitimate way** to get its new company registrations. That means an official free API or open-data file first, then a free key, then paid or commercial sources.
2. Tell me **exactly** how to get access: the sign-up URL, what to request, and roughly how long it takes.
3. For countries with no adapter yet, help me **write a provider adapter** that fits the interface in section 6.
4. Be honest when a country has **no usable source**, or when using one would be illegal or unwise (sanctions, privacy).

Rules I must keep:
- **Real, official, documented sources only.** No scraping that breaks a site's terms. No invented endpoints. No fake data.
- Respect marketing restrictions (GDPR/ePrivacy/PECR, Denmark's *reklamebeskyttelse*, the Dutch KVK *non-mailing* flag, and so on).
- The app only **retrieves** data. It never sends email or messages automatically.

---

## 2. Summary

| Status | Countries | Why no data |
|---|---|---|
| ✅ **Working** | Norway, Finland, Ireland | — (Ireland lags; see section 3) |
| 🔑 **Adapter built, missing credentials** | United Kingdom, France, Netherlands, Germany, Denmark, Estonia | Code is ready; the API key or login is not in `.env.local` |
| 📝 **Needs approval, no adapter** | Sweden | Needs a client certificate from SCB, and the API schema is only visible after approval |
| 🔍 **No adapter (under research)** | 45 others | No code exists, only a placeholder that fetches nothing |
| ⛔ **Not applicable** | Vatican City | Has no commercial company register |

Database counts (all real registry data, no demo data):

| Country | Companies stored | Latest registration date | Source |
|---|---|---|---|
| 🇳🇴 Norway | 4,365 | 10 Oct 2026 | `brreg` |
| 🇫🇮 Finland | 1,076 | 10 Oct 2026 | `prh` |
| 🇮🇪 Ireland | 241 | **29 Sep 2026** | `cro` |
| All other countries | **0** | — | — |

Environment variables currently set: `MONGODB_URI`, `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `REAL_DATA_MODE`, `DEMO_MODE`, `SEED_DEV_ACCOUNTS`, `DEMO_PASSWORD`, `EMAIL_PROVIDER`, `CRON_SECRET`. **No registry API keys are set.**

---

## 3. Working countries

| Country | API used | Access | Freshness | Notes |
|---|---|---|---|---|
| 🇳🇴 Norway | **Brønnøysundregistrene (Enhetsregisteret)**. REST `https://data.brreg.no/enhetsregisteret/api`: `/enheter` (search by registration date), `/enheter/{orgnr}`, `/oppdateringer/enheter` (change feed, polled every 60 s) | Open, no key (NLOD licence) | Near real-time (batches of about 5 min) | Returns email, phone, mobile and website when the company registered them. Works well. |
| 🇫🇮 Finland | **PRH YTJ open data v3**. REST `/companies?registrationDateStart=&registrationDateEnd=` | Open, no key (CC BY 4.0) | Daily | Website only. PRH does not publish email or phone. |
| 🇮🇪 Ireland | **CRO open data (CKAN)**. `https://opendata.cro.ie/api/3/action/datastore_search_sql`, filtering on `company_reg_date` | Open, no key (CC BY 4.0) | Labelled "daily", but **actually lags** | **Problem:** the newest registration is 29 Sep 2026 and the dataset was last published 30 Sep 2026. The 10 Oct sync for 9–10 Oct returned **0 rows**. The sync works, but CRO hasn't republished the dataset for about 11 days. No email or phone. **Question:** is there a fresher official CRO source (for example the CORE API, which is paid, or the CRO Gazette)? |

---

## 4. Adapter built, only credentials missing

For these countries the code already exists in `src/features/registry/providers/`. Each one starts syncing after I add its variables to `.env.local`, restart, and run `npm run registry:verify -- <CODE>`.

| Country | Adapter file | API used | Env variables needed | How to get access | Cost | Contact fields |
|---|---|---|---|---|---|---|
| 🇬🇧 United Kingdom | `companies-house.ts` + `companies-house-stream.ts` | **Companies House Public Data API**: `/advanced-search/companies?incorporated_from=&incorporated_to=`, `/company/{number}`. **Streaming API**: `https://stream.companieshouse.gov.uk/companies` | `UK_COMPANIES_HOUSE_API_KEY` (REST), `UK_COMPANIES_HOUSE_STREAMING_API_KEY` (stream, a separate application) | Register at https://developer.company-information.service.gov.uk/ and create a REST key, plus a separate Streaming key | Free | None (address only). Limit: 600 requests per 5 minutes. |
| 🇫🇷 France | `insee-sirene.ts` | **INSEE API Sirene 3.11**: `/siret?q=dateCreationUniteLegale:[D TO D]` | `FRANCE_SIRENE_API_KEY` (optional: `FRANCE_SIRENE_API_URL`, `FRANCE_INCLUDE_SOLE_TRADERS`) | Account at https://portail-api.insee.fr/, then subscribe to API Sirene | Free | None. Units that are only partially public must be skipped. |
| 🇳🇱 Netherlands | `kvk.ts` | **KVK Mutatieservice** (signal `SignaalNieuweInschrijving`) + **Basisprofiel API** | `NL_KVK_API_KEY`, `NL_KVK_SUBSCRIPTION_ID` (optional: `NL_KVK_API_URL`) | https://developers.kvk.nl (pricing: https://developers.kvk.nl/pricing) | **Paid** subscription | None. Must respect `indNonMailing`. Tested against KVK's test environment only. |
| 🇩🇪 Germany | `openregister.ts` | **OpenRegister** (commercial; Germany has no official API): `POST https://api.openregister.de/v1/search/company` with an `incorporated_at` filter | `OPENREGISTER_API_KEY` | https://openregister.de | **Commercial** | Not provided. **Question:** is there a cheaper or official alternative (Handelsregister bulk data, the HVD regulation, OffeneRegister.de)? |
| 🇩🇰 Denmark | `cvr.ts` | **CVR system-to-system** (Elasticsearch): `POST http://distribution.virk.dk/cvr-permanent/virksomhed/_search`, with a range on `livsforloeb.periode.gyldigFra` | `DENMARK_CVR_USERNAME`, `DENMARK_CVR_PASSWORD` | Email **cvrselvbetjening@erst.dk** and ask for system-to-system access (guide: https://erhvervsstyrelsen.dk/vejledning-adgang-til-cvr-data-system-til-system) | Free | Email, phone, website. Companies marked *reklamebeskyttet* must not get marketing. **Question:** is the newer Datafordeler CVR API a better choice? |
| 🇪🇪 Estonia | `rik.ts` | **RIK e-Business Register XML/SOAP**: `https://ariregxmlv6.rik.ee/`, services `ettevotjaMuudatusedTasuline_v1` (changes by date) + `detailandmed_v2` | `ESTONIA_RIK_USERNAME`, `ESTONIA_RIK_PASSWORD` | Agreement at https://ariregister.rik.ee/eng/contract/step1 (reviewed within about 5 working days) | Free for API-only use (50,000 answers per day) | Email, phone, mobile, website. **Question:** could RIK's free daily open-data files (https://avaandmed.ariregister.rik.ee) serve as a no-agreement alternative? |

Commercial fallback for **any** country: `opencorporates.ts`, env `OPENCORPORATES_API_TOKEN`, enabled per country in **Settings → Countries**. It needs a paid OpenCorporates licence, and the terms must be checked for each jurisdiction.

---

## 5. No adapter yet

These use a placeholder provider (`not-connected.ts`) that fetches nothing. The "Candidate source" column holds earlier research, and **none of it has been verified**. Please check each one.

**Hint:** under the EU High-Value Datasets regulation (Implementing Regulation (EU) 2023/138, applicable since June 2024), EU member states must publish basic company data free of charge through an API or bulk download. That is likely the best lead for every EU country below.

### Higher priority (EU / EEA, large markets)

| Country | Official register | Candidate source (unverified) | Known blocker |
|---|---|---|---|
| 🇸🇪 Sweden | SCB Företagsregistret / Bolagsverket | SCB Business Register API `https://privateapi.scb.se/nv0101/v1/sokpavar`, up to 2,000 rows per call, nightly | Needs a **client certificate** from SCB (scbforetag@scb.se), and the schema is only visible after approval. Bolagsverket's free "Värdefulla datamängder" API only looks up one organisation number at a time. Its bulk file is weekly. |
| 🇪🇸 Spain | Registro Mercantil / BORME | BORME daily incorporations via BOE open data (`https://www.boe.es/datosabiertos/`) | Parsing format not verified |
| 🇮🇹 Italy | Registro delle Imprese (InfoCamere) | — | Paid only (InfoCamere); HVD options unverified |
| 🇵🇱 Poland | KRS / CEIDG | KRS open API (one company at a time); CEIDG API for sole traders (needs a token) | No date-based listing found yet |
| 🇧🇪 Belgium | KBO/BCE (Crossroads Bank for Enterprises) | KBO Open Data files (free registration) | Update cadence not verified |
| 🇦🇹 Austria | Firmenbuch | — | Paid through clearing agencies; HVD open data not verified |
| 🇨🇭 Switzerland | Zefix / SHAB | Zefix REST API (free credentials) + SHAB daily publications | Not verified |
| 🇨🇿 Czechia | Public Register / ARES | ARES REST API, justice.cz open-data files | Date filtering not verified |
| 🇸🇰 Slovakia | RPO (Statistical Office) | RPO REST API `api.statistics.sk/rpo/v1` + incremental files | Production endpoint **timed out** in testing; date parameters unknown |
| 🇵🇹 Portugal | Registo Comercial (IRN) | — | Not researched |
| 🇷🇴 Romania | ONRC | — | Not researched |
| 🇬🇷 Greece | GEMI (businessportal.gr) | — | Not researched |
| 🇭🇺 Hungary | Céginformációs Szolgálat | — | Not researched |

### Medium priority

| Country | Official register | Candidate source (unverified) |
|---|---|---|
| 🇱🇻 Latvia | Uzņēmumu reģistrs | Open data on data.gov.lv |
| 🇱🇹 Lithuania | Registrų centras | — |
| 🇸🇮 Slovenia | AJPES | — |
| 🇭🇷 Croatia | Sudski registar | — |
| 🇧🇬 Bulgaria | Registry Agency | — |
| 🇱🇺 Luxembourg | LBR / RCS | — |
| 🇨🇾 Cyprus | Registrar of Companies | — |
| 🇲🇹 Malta | Malta Business Registry | — |
| 🇮🇸 Iceland | Skatturinn (Fyrirtækjaskrá) | — |
| 🇱🇮 Liechtenstein | Handelsregister (oera.li) | — |

### Lower priority or needs a legal decision first

| Country | Note |
|---|---|
| 🇯🇪 Jersey, 🇬🇬 Guernsey, 🇮🇲 Isle of Man, 🇬🇮 Gibraltar, 🇫🇴 Faroe Islands | Crown dependencies and territories. Small, not researched. |
| 🇦🇱 Albania, 🇧🇦 Bosnia and Herzegovina, 🇲🇪 Montenegro, 🇲🇰 North Macedonia, 🇷🇸 Serbia, 🇽🇰 Kosovo | Western Balkans. Not researched. Bosnia splits registration across entity-level registers. |
| 🇦🇩 Andorra, 🇲🇨 Monaco, 🇸🇲 San Marino | Microstates. Not researched. |
| 🇲🇩 Moldova | Open data on date.gov.md (cadence not verified) |
| 🇹🇷 Türkiye, 🇬🇪 Georgia, 🇦🇲 Armenia, 🇦🇿 Azerbaijan, 🇰🇿 Kazakhstan | Transcontinental. Not researched. |
| 🇺🇦 Ukraine | Some register access is restricted under martial law. Needs a legal review. |
| 🇧🇾 Belarus, 🇷🇺 Russia | **Sanctions**: legal review required before any use |
| 🇻🇦 Vatican City | No commercial register exists. Skip it. |

---

## 6. How the code works (for writing a new adapter)

**Stack:** Next.js 16 (App Router), TypeScript, Mongoose 8, MongoDB Atlas. All registry calls run server-side only.

**Key files**

| File | Purpose |
|---|---|
| `src/features/registry/types.ts` | The `CompanyRegistryProvider` interface and the `NormalizedCompany` shape |
| `src/features/registry/providers/brreg.ts` | **Reference implementation** (Norway). Copy this pattern. |
| `src/features/registry/providers/index.ts` | Registers each adapter factory (`REAL_FACTORIES`) |
| `src/config/jurisdictions.ts` | One entry per country: `providers: ["adapter-id"]`, plus `state` and `evidence` |
| `src/features/registry/sync.ts` | Sync engine: calls `getRegistrations(from, to)`, dedupes, and saves |
| `src/features/registry/scheduler.ts` | In-process worker: live feeds every 30 s, scheduled syncs every 5 min |
| `src/features/registry/http.ts` | Shared HTTP helper (timeouts, retries) |
| `docs/providers/<country>.md` | One doc per connected source |

**Provider interface (shortened)**

```ts
interface CompanyRegistryProvider {
  id: string;                 // e.g. "brreg"
  countryCode: string;        // ISO-2, e.g. "NO"
  name: string; sourceName: string;
  sourceType: "OFFICIAL_REGISTRY" | "OFFICIAL_OPEN_DATA" | "COMMERCIAL" | "DEMO";
  freshness: "REAL_TIME" | "NEAR_REAL_TIME" | "DAILY" | "PERIODIC" | "UNKNOWN";
  isDemo: boolean;
  accessType?: "OPEN" | "API_KEY" | "AGREEMENT" | "COMMERCIAL" | "NONE";
  registrationDateType?: string;   // what the date means at this source
  homepage: string; docsUrl?: string; description: string; limitations?: string;
  capabilities: ProviderCapabilities;   // supportsDailyRegistrations, supportsEmail, ...
  requiredEnv: string[];               // env var names only
  isConfigured(): boolean;
  recommendedSyncMinutes: number;

  // REQUIRED for the daily "new registrations" view:
  getRegistrations?(from: Day, to: Day, ctx: { limit: number; signal?: AbortSignal; log?: (m: string) => void })
    : Promise<{ companies: NormalizedCompany[]; total?: number; complete: boolean }>;
  getCompany?(registrationNumber: string): Promise<NormalizedCompany | null>;
  getPeople?(registrationNumber: string): Promise<{ people: NormalizedPerson[]; contactPerson?: NormalizedPerson }>;
  pollChanges?(cursor: string | null, ctx): Promise<ChangeBatch>;   // optional live feed
  feedIntervalSeconds?: number;
  getLatestPublication?(): Promise<Date | null>;
  checkStatus(): Promise<{ state: "CONNECTED" | "UNAVAILABLE" | "CREDENTIALS_REQUIRED" | "NOT_CONNECTED"; message?: string; checkedAt: Date }>;
}
```

`NormalizedCompany` contains `identity` (sourceId, name, registrationNumber), `registration` (registrationDay as `YYYY-MM-DD` in the country's local calendar, status, legalForm), `classification` (industry code, NACE), `contact` (email, phone, mobile, website), `address` (business, postal), `people`, `marketingProtected`, and `source` (url, publishedAt, raw). **Fields the source does not return must stay `undefined`.**

**Steps to add a country**
1. Create `src/features/registry/providers/<id>.ts` that implements the interface, using `brreg.ts` as the model.
2. Register it in `providers/index.ts` → `REAL_FACTORIES`.
3. In `src/config/jurisdictions.ts`, set that country's `providers: ["<id>"]` and update `state`, `evidence`, `feed`, `access`, and so on.
4. Add any env variables to `.env.example`.
5. Test against the real source with `npm run registry:verify -- <CODE>`.
6. Run a backfill with `npm run registry:sync -- <CODE>` (or `-- <CODE> 2026-10-10` for one day).
7. Regenerate the coverage report with `npm run coverage:report`.

---

## 7. What I'd like back from you

For each country, in priority order:
- the **best source** (official API, bulk file, or commercial), with its URL;
- **access steps** and cost;
- whether it supports **"list companies registered on date X"**, which is required;
- which **contact fields** it returns;
- any **legal or marketing restrictions**;
- for sources without an adapter: a **TypeScript adapter** that follows section 6.
