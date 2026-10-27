# Country business-data status

_Updated 27 Oct 2026 (coverage beyond Europe: Poland, United States, Canada, Australia; Japan adapter awaiting credentials). Earlier sections were updated 18 Oct 2026 from the live database (MongoDB Atlas, database `ExploreTechify`), the source code and live checks against each official source. Per-jurisdiction detail (generated): [`docs/coverage/jurisdictions.md`](coverage/jurisdictions.md). Adapter docs: [`docs/providers/`](providers/README.md)._

## 0. Coverage matrix by tier (27 Oct 2026)

The Owner sees this on **Company Intelligence → Coverage** (with a region filter), and the sidebar uses the same order. Tiers: **1** = verified, working **same-day** feed with synchronized data · **2** = working feed, not reliably same-day (or connected and awaiting its first sync) · **3** = partial, credential-gated, paid, failing or unavailable. Europe first inside each tier. A country without data for a day shows **No verified data available** — nothing is estimated or reused.

"Same-day" was checked against stored data: share of companies first seen on their own registration day (Oct 2026): Norway 46 %, every other existing source ≈ 0 % (medians: IE 1 day, FI / LV / EE 2, CZ 4, CH 6, FR 9 days). Poland's bulletin for 26 Oct was already published at 21:10 Warsaw time the same day.

| Tier | Country | Official source (adapter) | Update window | Registration date | Status |
|---|---|---|---|---|---|
| 1 | 🇳🇴 Norway | Brønnøysundregistrene (`brreg`) | Same day (real-time API) | Registry entry date | LIVE |
| 1 | 🇵🇱 Poland | KRS open API — daily bulletin + official extract (`krs-pl`) | Same day | `dataRejestracjiWKRS` | **NEW** — adapter verified live; LIVE after its first sync |
| 2 | 🇮🇪 Ireland | CRO open data (`cro`) | ~1 day | CRO registration date | LIVE |
| 2 | 🇫🇮 Finland | PRH open data (`prh`) | 1–2 days | Trade register date | LIVE |
| 2 | 🇱🇻 Latvia | UR `register.csv` (`ur-lv`) | 1–2 days | Registration date | LIVE |
| 2 | 🇪🇪 Estonia | RIK open data (`rik-open-data`) | 1–2 days | Registry entry date | LIVE |
| 2 | 🇨🇿 Czechia | ARES batches (`ares-cz`) | 1–4 working days | Datum zápisu | LIVE |
| 2 | 🇨🇭 Switzerland | SHAB HR01 (`shab`) | 1–5 working days | Journal date | LIVE |
| 2 | 🇫🇷 France | BODACC A (`bodacc`) | ~1–2 weeks | Date d'immatriculation | LIVE |
| 2 | 🇺🇸 United States (NY, CO, CT) | State open-data portals, Socrata (`us-state-open-data`) | 1–3 days | State filing / formation date | **NEW** — verified live |
| 2 | 🇨🇦 Canada (federal) | Corporations Canada daily CSV (`corporations-canada`) | ~1 day | CBCA anniversary date (incorporation / amalgamation / continuance) | **NEW** — verified live |
| 2 | 🇦🇺 Australia | ASIC Company Dataset, data.gov.au (`asic-au`) | 1–2 days (newest day partial) | ASIC registration date | **NEW** — verified live |
| 3 | 🇬🇧 United Kingdom | Companies House REST + streaming (`companies-house`) | Same day (documented) | Incorporation date | READY — needs free key |
| 3 | 🇩🇰 Denmark | CVR (`cvr`) | Not measured | Start date | READY — needs free access |
| 3 | 🇯🇵 Japan | NTA Corporate Number Web-API (`nta-jp`) | Daily per documentation | Corporate-number designation date (labelled; not the registration date) | READY — needs free application ID; **not run live** |
| 3 | 🇳🇱 Netherlands / 🇩🇪 Germany | KVK / OpenRegister | ≤ 1 day (documented) | — | PAID |
| 3 | 🇸🇬 Singapore | ACRA on data.gov.sg | **Monthly** bulk (last 14 Oct 2026) | — | No adapter (not daily) |
| 3 | 🇹🇼 Taiwan | GCIS open-data API | — | — | LOOKUP ONLY (no date filter, verified) |
| 3 | 🇳🇿 New Zealand | Companies Office / NZBN API | — | — | Needs free subscription key (401 without) — no adapter |
| 3 | 🇮🇳 India | MCA data on data.gov.in | Periodic | — | Not verified (catalogue did not answer) |
| 3 | 🇰🇷 South Korea · 🇭🇰 Hong Kong · 🇦🇪 UAE · 🇸🇦 Saudi Arabia · 🇶🇦 Qatar | — | — | — | N/A — no open feed found (desk research, not verified) |
| 3 | 🇸🇪 SE · 🇧🇪 BE · 🇦🇹 AT · 🇮🇹 IT · 🇪🇸 ES · 🇱🇺 LU and the rest of Europe | see section 1 | — | — | N/A / PAID / under research |

Blockers that need the Owner: UK, Denmark, Japan, New Zealand, Belgium and Croatia need free credentials or accounts (section 4). Hong Kong and South Korea registries are paid per search. US coverage is three states; most US states, and Canada's provinces, publish no verified open daily feed.

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
| 🇵🇱 Poland | KRS open API: `/Biuletyn/{date}` + `/OdpisAktualny/{krs}` (`krs-pl`) | Yes | Same day | Yes (dataRejestracjiWKRS) | Yes, when registered | No | Yes, when registered | No (names masked) | Free API | No | No | **NEW (verified 27 Oct 2026)** | Business register (KRS P) only; foreign branches marked |
| 🇺🇸 United States | NY / CO / CT open data, Socrata (`us-state-open-data`) | Yes | Daily (1–3 day lag) | Yes (filing date) | CT only | No | No | NY chairman (corporations) | Free API | No | No | **NEW** | 3 of 50 states; not-for-profits excluded |
| 🇨🇦 Canada | Corporations Canada federal CSV (`corporations-canada`) | Yes | Daily | Yes (anniversary date) | No | No | No | No | Free download | No | No | **NEW** | Federal (CBCA) corporations only |
| 🇦🇺 Australia | ASIC Company Dataset, data.gov.au (`asic-au`) | Yes | Daily (1–2 days) | Yes | No | No | No | No | Free API | No | No | **NEW** | No address in the open dataset |
| 🇨🇿 Czechia | ARES notification batches, public register (`ares-cz`) | Yes | Daily (working days) | Yes (datum zápisu) | No | No | No | **Yes** (jednatel / board) | Free API | No | No | **LIVE (new)** | Business forms only by default; officers stored as name + role only |

### READY — adapter built, needs your free setup

| Country | Registry / source (adapter) | Registration date | Email | Phone | Website | Contact person | Access model | Credential required | Paid | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 🇬🇧 United Kingdom | Companies House REST + Streaming (`companies-house`) | Yes | No | No | No | Yes (officers) | Free API + registration | `UK_COMPANIES_HOUSE_API_KEY` (+ `UK_COMPANIES_HOUSE_STREAMING_API_KEY`) | No | **READY** |
| 🇩🇰 Denmark | CVR system-to-system (`cvr`) | Yes | Yes, when registered | Yes, when registered | Yes, when registered | No | Free API + registration | `DENMARK_CVR_USERNAME`, `DENMARK_CVR_PASSWORD` | No | **READY** |
| 🇫🇷 France (alternative) | INSEE API Sirene 3.11 (`insee-sirene`) | Yes (creation date) | No | No | No | No | Free API + registration | `FRANCE_SIRENE_API_KEY` | No | Optional — BODACC is the default |
| 🇯🇵 Japan | NTA Corporate Number Web-API (`nta-jp`) | Designation date (labelled) | No | No | No | No | Free API + registration | `JAPAN_HOUJIN_APP_ID` | No | **READY** (not run live) |
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

The country list is **ordered by data, not alphabetically**. It is recomputed on every page load. First by **coverage tier** (section 0: same-day → recent → partial / unavailable), then **Europe first**, then by source health and the daily snapshots of the last 30 days:

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
| Japan | Register for a Web-API application ID at https://www.houjin-bangou.nta.go.jp/webapi/ → `JAPAN_HOUJIN_APP_ID`, then `npm run registry:verify -- JP` | Free |
| New Zealand | Subscribe to the Companies Register / NZBN API at https://api.business.govt.nz (subscription key), so an adapter can be built and verified | Free |
| United States (optional) | A Socrata app token (`US_SOCRATA_APP_TOKEN`) raises the open-data rate limits | Free |

After adding variables to `.env.local` (or the server), restart and run `npm run registry:verify -- <CODE>`.

## 5. Deployment note

Another running instance (the deployed site) uses the same database and still runs older code. Its startup check resets provider IDs it does not know: France goes back to `insee-sirene` and Czechia to its catalogue placeholder. Their imported companies stay. The same applies to the adapters added on 27 Oct 2026 (Poland `krs-pl`, `us-state-open-data`, `corporations-canada`, `asic-au`, `nta-jp`): an older instance resets them to placeholders until it is redeployed. Once this code is deployed, both switch back automatically: Czechia because its placeholder no longer exists, and France through the one-way upgrade in `ensureCountries` (only while no INSEE key is set).

**27 Oct 2026 status check (read from the database, sources re-tested live):**

- **Switzerland "Provider error":** every run since 26 Oct failed on the server with `SHAB … is unreachable (fetch failed)`. The same requests succeed from a development machine (146 / 115 entries for 27 / 26 Oct), so the source is up and the failure is on the network path of the instance that ran the sync. The SHAB client now waits longer (60 s, 5 retries), and network errors now include their cause (e.g. `fetch failed: ECONNRESET`), so the next failure shows why.
- **Poland "Not synced":** the deployed instance reset the provider to `catalogue-pl`. Runs on the new code never finished: the bulletin takes ~25 s and each extract 3–8 s, read one after another (20+ minutes per day). Body-read timeouts were also not retried (`The operation was aborted due to timeout`). Extracts are now read 4 in parallel (`POLAND_KRS_CONCURRENCY`), timeouts are retried and a few unreadable extracts are skipped (run marked incomplete) instead of failing the day. Verified live: 296 new companies on 27 Oct (80 with email, 24 with a website) and 324 on 26 Oct (87 email, 24 website, ~15 min per day).
- **US / Canada / Australia "Not synced":** all three sources respond correctly. These countries have never completed a run on the database because the deployed code does not know their providers. Australia's dataset trails by 1–2 days (27 Oct empty, 26 Oct partial, 22–23 Oct ~1,000 per day), so "today" stays at 0 even when the source is healthy.
- **Oregon added** to `us-state-open-data` (`data.oregon.gov` `tckn-sxa6`): ~200–700 new entities per working day, 1-day lag, with an authorized representative or registered agent name.

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
