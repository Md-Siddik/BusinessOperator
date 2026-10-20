# Country business-data status

_Updated 18 Oct 2026 from the live database (MongoDB Atlas, database `ExploreTechify`), the source code and live checks against each official source. Per-jurisdiction detail (generated): [`docs/coverage/jurisdictions.md`](coverage/jurisdictions.md). Adapter docs: [`docs/providers/`](providers/README.md)._

Rules: official, documented sources only. No scraping that breaks terms, no CAPTCHA, login or block-page bypass, no invented endpoints, no dummy data. A country is **LIVE** only when a real sync has succeeded **and** registrations are stored. Registry adapters deliver registration facts; contacts come from the separate research step and never overwrite registry facts.

## 1. Coverage — every configured country

Access models ("free search" is not "free API"): **Free API** = documented API, no key · **Free API + registration** = free key / account / client credentials · **Free API + agreement** = free contract with the registry · **Free download** = open-data file · **Paid API** = subscription · **Commercial** = third-party paid service · **Search website only** = no automated access.

The contact columns say what the **registry itself** publishes. Website research (section 3) can add email, phone, website and contact person for any country.

### LIVE — free, no credentials

| Country | Registry / source (adapter) | Registration data | Update frequency | Registration date | Email | Phone | Website | Contact person | Access model | Credential | Paid | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 🇳🇴 Norway | Brønnøysundregistrene (`brreg`) | Yes | Real-time search + change feed | Yes | Yes, when registered | Yes, when registered | Yes, when registered | Yes (roles) | Free API | No | No | **LIVE** (protected) | NLOD. Respect Reservasjonsregisteret |
| 🇫🇮 Finland | PRH YTJ open data (`prh`) | Yes | Daily | Yes | No | No | Yes, when registered | No | Free API | No | No | **LIVE** (protected) | CC BY 4.0 |
| 🇮🇪 Ireland | CRO open data (`cro`) | Yes | Daily | Yes | No | No | No | No | Free API (CKAN) | No | No | **LIVE** (protected) | CC BY 4.0 |
| 🇱🇻 Latvia | UR open data `register.csv` (`ur-lv`) | Yes | Daily | Yes | No | No | No | No | Free download | No | No | **LIVE** (protected) | CC0. Commercial + enterprise registers only |
| 🇪🇪 Estonia | RIK open-data basic file (`rik-open-data`) | Yes | Daily | Yes | No¹ | No¹ | No¹ | No | Free download | No | No | **LIVE** (protected) | ¹ Yes via the RIK-agreement adapter `rik` |
| 🇨🇭 Switzerland | SHAB HR01 new entries (`shab`) | Yes | Daily (working days) | Yes (journal date) | No | No | No | No | Free API | No | No | **LIVE** (protected) | Published 1–5 working days after the journal date |
| 🇫🇷 France | BODACC A "Créations", DILA open data (`bodacc`) | Yes | Daily (publication days) | Yes (date d'immatriculation)² | No | No | No | **Yes** (Président / Gérant …) | Free API | No | No | **LIVE (new)** | Licence Ouverte 2.0. ² ≈ 18 % of notices omit it and are skipped. Legal persons only by default |
| 🇨🇿 Czechia | ARES notification batches, public register (`ares-cz`) | Yes | Daily (working days) | Yes (datum zápisu) | No | No | No | **Yes** (jednatel / board) | Free API | No | No | **LIVE (new)** | Business forms only by default; officers stored as name + role only |

### READY — adapter built, needs your free setup

| Country | Registry / source (adapter) | Registration date | Email | Phone | Website | Contact person | Access model | Credential required | Paid | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 🇬🇧 United Kingdom | Companies House REST + Streaming (`companies-house`) | Yes | No | No | No | Yes (officers) | Free API + registration | `UK_COMPANIES_HOUSE_API_KEY` (+ `UK_COMPANIES_HOUSE_STREAMING_API_KEY`) | No | **READY** |
| 🇩🇰 Denmark | CVR system-to-system (`cvr`) | Yes | Yes, when registered | Yes, when registered | Yes, when registered | No | Free API + registration | `DENMARK_CVR_USERNAME`, `DENMARK_CVR_PASSWORD` | No | **READY** |
| 🇫🇷 France (alternative) | INSEE API Sirene 3.11 (`insee-sirene`) | Yes (creation date) | No | No | No | No | Free API + registration | `FRANCE_SIRENE_API_KEY` | No | Optional — BODACC is the default |
| 🇪🇪 Estonia (alternative) | RIK XML services (`rik`) | Yes | Yes | Yes | Yes | No | Free API + agreement | `ESTONIA_RIK_USERNAME`, `ESTONIA_RIK_PASSWORD` | Free within limits | Optional — adds registry contacts |

### PAID — adapter built, commercial access only

| Country | Source (adapter) | Access model | Credential | Status | Notes |
|---|---|---|---|---|---|
| 🇳🇱 Netherlands | KVK Mutatieservice + Basisprofiel (`kvk`) | Paid API | `NL_KVK_API_KEY`, `NL_KVK_SUBSCRIPTION_ID` | **PAID** | No free official feed of new registrations |
| 🇩🇪 Germany | OpenRegister (`openregister`) | Commercial | `OPENREGISTER_API_KEY` (currently empty) | **PAID** | The official Handelsregister has no free API or feed |

### N/A — no verified automated source yet (checked 18 Oct 2026)

| Country | Candidate source | Access model | What was found | Status |
|---|---|---|---|---|
| 🇸🇪 Sweden | Bolagsverket "värdefulla datamängder" API / SCB Business Register | Free API + registration | Lookup by organisation number only; docs behind a CAPTCHA (not bypassed) | **N/A** |
| 🇸🇰 Slovakia | RPO API `api.statistics.sk/rpo/v1` | Free API | Name / IČO lookups answer, but a date-only search did not answer within 90 s | **N/A** |
| 🇵🇱 Poland | KRS API `api-krs.ms.gov.pl` (Biuletyn + OdpisAktualny) | Free API | Maintenance page ("Przerwa techniczna") all day — contract unverified | **N/A** (retry) |
| 🇱🇹 Lithuania | Registrų centras open-data files | Free download | 403 to automated requests; get.data.gov.lt returned 500. Not bypassed | **N/A** |
| 🇧🇪 Belgium | KBO Open Data (incl. `contact.csv` with phone / email / web) | Free download + account | Download behind a free login; cadence unverified | **N/A** — best next candidate |
| 🇭🇷 Croatia | Sudski registar open API (`sudreg-data.gov.hr`) | Free API + registration (OAuth) | OpenAPI documentation reachable; needs your client registration | **N/A** — candidate |
| 🇪🇸 Spain | BORME (BOE open-data API) | Free API | Incorporations only as PDF per province | **N/A** |
| 🇦🇹 Austria | Firmenbuch | Paid (clearing agencies) | Free search website only | **N/A / paid** |
| 🇮🇹 Italy | Registro delle Imprese (InfoCamere) | Paid | — | **N/A / paid** |
| 🇧🇬 Bulgaria | Registry Agency portal | — | No documented date-window feed found | **N/A** |
| 🇨🇾 Cyprus | data.gov.cy registered organisations | Free download (periodic) | CKAN search endpoint 404; dataset unverified | **N/A** |
| All others | See [`docs/coverage/jurisdictions.md`](coverage/jurisdictions.md) | — | Not yet researched in depth | **N/A** |

## 2. Sidebar and ordering

The country list is **ordered by data, not alphabetically**. It is recomputed on every page load from source health and the daily snapshots of the last 30 days:

1. **LIVE + useful contact coverage** (≥ 5 companies and ≥ 5 % with a usable direct email or phone)
2. **LIVE** (registrations, little or no contact data yet)
3. **Not synced / Error** (source connected, nothing stored yet)
4. **READY**, then **PAID**
5. **PARTIAL** (lookup only)
6. **N/A**

Within a group the order is: recent registrations → latest successful sync (by day) → direct-contact rate → name. The badge shows today's count for LIVE countries (or `LIVE` before today's sync); otherwise it shows `Not synced`, `Error`, `READY`, `PAID`, `PARTIAL` or `N/A`. The tooltip carries the detail, for example "LIVE — 12 registered today · 598 new companies in 30 days · 7 with email · 1 with phone".

## 3. Contact enrichment

The registry provides company identity, registration date, industry, address and officers. Contact research then runs in the background job queue and never blocks the sync:

1. Registry re-check, where the source has a lookup.
2. **Official website**: the registry's website, or else **verified discovery**. Plausible own-domain candidates are fetched and accepted **only if the page shows the registration number** (confirmed) or the exact legal name (sent to review). A domain is never stored, and an address never generated, without that evidence.
3. Contact / Kontakt / Impressum / About pages (≤ 5 pages per site): published `mailto:` / `tel:` values, labelled numbers, and schema.org structured data (Organization email / telephone, `Person` + `jobTitle`). Third-party blocks (publisher, author, brand, agency) are ignored.
4. Optional paid providers (Hunter, Apollo, Brave Search). These stay off until you enable them with a budget.
5. Verification: an MX check. No-reply, invoice and placeholder addresses and implausible numbers are kept but never count as direct contact. Values shared by ≥ 3 companies are treated as intermediaries.

Politeness rules: robots.txt is respected, only public hosts are fetched (SSRF guard), timeouts are 10 s, responses are capped at 1.5 MB, there is **≥ 1 s between requests to the same host**, each URL is fetched once per research run, and retries follow a 1 / 3 / 7 / 14 / 30-day schedule. A site that cannot be read safely is marked **Research unavailable**. A company researched without result shows **No public contact found**, never an invented value.

Every value keeps its source (Registry · Company website · Public business source · Enrichment provider · Manual) and a verification state. Research never overwrites registry facts.

**Fixed 18 Oct 2026:** scheduled research retries never ran. The retry was queued while its own job was still running, and that job was then marked done. A new sweep (`scheduleDueRetries`, every slow scheduler tick, ≤ 200 per tick) now queues due retries from `research.nextRetryAt`. Website research also gained support for Latvia, Switzerland and Czechia (domains, national phone formats, legal forms); before this, it had found no contacts at all for Latvia and Switzerland.

## 4. What needs you

| Country | What to do | Cost |
|---|---|---|
| United Kingdom | Register at https://developer.company-information.service.gov.uk/ and create a REST key (plus a separate Streaming key) → `UK_COMPANIES_HOUSE_API_KEY` | Free |
| Denmark | Ask cvrselvbetjening@erst.dk for system-to-system access → `DENMARK_CVR_USERNAME`, `DENMARK_CVR_PASSWORD` | Free |
| Belgium | Create a KBO Open Data account (https://kbopub.economie.fgov.be/kbo-open-data) and share the download documentation, so an adapter can be built and verified | Free |
| Croatia | Register an API client at https://sudreg-data.gov.hr and share how credentials are issued | Free |
| Estonia (optional) | Sign the RIK agreement (https://ariregister.rik.ee/eng/contract/step1), then select provider `rik` for registry email / phone / website | Free within limits |
| Contact discovery (optional) | Add a Brave Search API key (`BRAVE_SEARCH_API_KEY`) and a budget in Settings → Research, so research can find websites that are neither on the registry nor on an obvious domain | Paid per Brave's plan |
| Netherlands / Germany | KVK subscription / OpenRegister key | Paid |

After adding variables to `.env.local` (or the server), restart and run `npm run registry:verify -- <CODE>`.

## 5. Deployment note

Another running instance (the deployed site) uses the same database and still runs older code. Its startup check resets provider IDs it does not know: France goes back to `insee-sirene` and Czechia to its catalogue placeholder. Their imported companies stay. Once this code is deployed, both switch back automatically: Czechia because its placeholder no longer exists, and France through the one-way upgrade in `ensureCountries` (only while no INSEE key is set).

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
