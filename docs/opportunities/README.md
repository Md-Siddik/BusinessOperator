# Verified Opportunity Intelligence (owner-only)

Discovers, verifies and monitors genuine **hiring** opportunities (employers recruiting) and **service & project** opportunities (organizations publicly seeking suppliers) in Norway, Sweden, Denmark, Finland, Germany, France and the United Kingdom.

Status as of 2026-10-11. "Tested with real data" means the adapter was run against the live source during development: it fetched, normalized, ingested, re-ran idempotently and passed a status check. "Built from docs" means the adapter follows the official documentation but has not yet run with real credentials.

## Access: owner only

Access is gated on the account's **role**, never on a permission. ADMIN and STAFF permission lists are editable, so a permission could be delegated; the OWNER role cannot.

| Layer | Enforcement |
|---|---|
| Proxy (`src/proxy.ts`) | `/dashboard/opportunities/**` returns a plain `404` for any signed session whose role isn't `OWNER`; anonymous users go to `/login`. |
| Pages | The module layout and every page call `requireOwnerPage()`, which renders `notFound()` for non-owners. Page titles are rendered only for the owner (`ownerMetadata`). |
| API (`/api/opportunities/**`) | `route({ ownerOnly: true })` returns `401` when unauthenticated and `403` for ADMIN, STAFF and CLIENT. The actor is always loaded from the database, never from the request. |
| Service layer | Every exported function in `features/opportunities/service.ts` calls `assertOwner(actor)` before any query or mutation. |
| Navigation | The sidebar group is rendered only when `isOwner(actor)`. |
| Indexing | `/dashboard` and `/api/` are disallowed in `robots.ts`; the app layout is `noindex`; nothing from the module appears on public pages, public APIs, the sitemap or the client portal. |

Provider credentials live only in server environment variables. The UI and API show variable **names** and whether they are set, never their values.

## Architecture

```
features/opportunities/
  constants.ts        enums, labels, documented metric definitions (client-safe)
  providers/          one adapter per source, all implementing OpportunityProvider (types.ts)
  normalize.ts        URL / date / name normalization, CPV → service categories
  verification.ts     pure trust rules: activity, labels, review reasons, contact routes
  company-link.ts     links to Company Intelligence by registration number or official domain only
  ingest.ts           idempotent upsert, duplicate grouping, explicit removals
  sync.ts             feed runs, status checks, staleness / expiry, archival, employer-board verification
  service.ts          owner-only queries and actions used by pages and API routes
models/Opportunity.ts      Opportunity + OpportunityEvent (status / verification history)
models/OpportunityFeed.ts  OpportunityFeed (provider or employer feed, cursor, health) + OpportunitySyncRun
```

- **Scheduling.** Feeds run on the existing slow tick (`features/registry/scheduler.ts`, every 5 minutes; each feed keeps its own interval). Manual "Sync now" and "Re-check" requests go through the existing durable job queue (fast tick). With `REGISTRY_SCHEDULER=off`, the existing `/api/registry/cron` and `/api/jobs/cron` endpoints drive the same work. Set `OPPORTUNITY_SCHEDULER=off` to pause only this module.
- **Politeness.** Feeds reuse the registry HTTP client: per-provider throttling, retries with backoff honouring `Retry-After`, timeouts and a circuit breaker. Feed runs take a lease lock and are capped (`OPPORTUNITY_RUN_LIMIT`); a capped run resumes from its cursor on the next tick (TED: `day:page`, BOAMP: `day|offset`, UK OCDS: the source's `next` link). Failures back off exponentially, and HTTP 429 pauses the feed.
- **Migrations.** MongoDB collections and indexes are created by Mongoose when the models load. No data migration is needed; nothing existing changes shape.

## Trust model

Verification has four separate dimensions, and there is never a single "verified" badge:

1. **Source classification.** Official employer source, Official employer ATS, Official procurement portal, Public employment service, Official company announcement, Third-party aggregator, or Unverified source.
2. **Source verification.** The record came from an authoritative public API; or an ATS board is linked from the employer's official website (checked by fetching the site, respecting robots.txt); or the page sits on the official domain. Otherwise it is "not checked" or "link not found".
3. **Employer identity.**
   - **Confirmed:** a registry match by registration number or exact official domain, or an ATS board linked from the official site.
   - **Registration number supplied:** the source supplied a number that doesn't match a stored registry record.
   - **Not confirmed:** neither of the above.
   - A poster whose name indicates a recruitment or staffing agency is **never** confirmed as the employer.
4. **Activity.** One of:
   - `ACTIVE`: confirmed by the source within the freshness window.
   - `EXPIRED`: a deadline the source published has passed.
   - `CLOSED`: the source explicitly removed, cancelled or closed it.
   - `UNKNOWN`: activity can't currently be confirmed.

   A failed request **never** closes a record. After three consecutive failed checks, the record is flagged for review.

The verification labels derived from these dimensions are: Verified official source, Employer identity confirmed, Active status checked, Needs manual review, Unverified, Closed or expired, and Removed at source.

**Review reasons** are concrete: aggregator source, unknown publisher, ATS board not linked from the official site, missing employer name, agency poster, or repeated failed checks. The owner records an assessment ("confirmed genuine", "could not confirm", "not genuine"); it is stored as evidence and never overwrites what the source says.

**Timestamps** are stored in UTC and shown in the opportunity's country time zone:

- `publishedAt` / `sourceUpdatedAt`: from the source only. They stay empty when the source has none.
- `firstSeenAt`: discovery by ExploreTechify.
- `lastSeenAt`: the last time the source confirmed the record.
- `lastCheckedAt`: the last check attempt, plus its result.

Date filters always name the field they apply to. "Today" is evaluated in the selected country's time zone, or UTC when no country is selected.

**Deduplication** never deletes. Records that match are grouped (`dupGroup`):

- **Canonical URL:** the same application or notice URL, ignoring `www` and tracking parameters.
- **Strict fallback:** same country, the same registration number or normalized organization name, and the same normalized title, plus the deadline day for tenders. Applied only when the key is unique within each provider.

The most authoritative record is canonical, and the owner's state (saved, notes, review) moves with it. Lists and metrics count canonical records; the detail page lists every source record as evidence.

**Contacts** are stored only as the source published them, with provenance (provider, source URL, date seen). A contact whose email domain differs from the buyer's domain (for example, a procurement agent) is flagged third-party. Contact routes distinguish:

- direct application link
- official procurement submission link
- official organization channel
- named contact on the notice
- third-party route
- none found

**Inferred needs stay separate.** Opportunities here are explicit published requests only. Service categories come from published CPV codes or published title keywords, and the basis is shown. "Weak website" style inferences remain in Company Intelligence (service fit) and are never presented as purchase requests.

**Retention.** Records closed or expired for 30 days are archived (description purged; history kept), unless the owner saved or annotated them. Sources whose terms require it (NAV) have content purged as soon as the source marks a record inactive.

## Metric definitions

All metrics count canonical, non-archived records. These are also shown in the dashboard.

| Metric | Definition |
|---|---|
| Discovered | First discovered by ExploreTechify in the period (discovery timestamp, not publication date). |
| Active (status checked) | Activity `ACTIVE`: listed by the source at its last successful check, no published deadline passed. |
| From official sources | Open records whose publisher is an official employer, ATS, procurement portal or public employment service. |
| Tender deadlines ≤ 14 days | Open procurement records with a source-published deadline in the next 14 days. |
| Awaiting manual review | Records labelled "Needs manual review". |
| Distinct hiring organizations | Distinct registration numbers, or normalized names, among open hiring records. Ten postings by one employer count once. |
| Closed or expired | Activity `CLOSED` or `EXPIRED`. |
| Duplicates folded | Non-canonical source records. |
| Sync failures | Failed runs in the period. |

## Source coverage matrix

| Source | Type | Countries (coverage) | Access | Closure detection | Status at delivery |
|---|---|---|---|---|---|
| Arbetsförmedlingen JobTech (JobSearch + JobStream) | Hiring | SE (national official) | Open, no key | Explicit removals (stream) + per-ad check | **Tested with real data**, enabled by default (scope: Data/IT occupation field) |
| NAV Arbeidsplassen feed | Hiring | NO (national official) | Free consumer token on request; terms require removing inactive ads | Explicit (ACTIVE/INACTIVE) | Built from NAV's OpenAPI spec; **needs `NAV_JOB_FEED_TOKEN`**. NAV's rotating public token returned HTTP 500 during development. |
| France Travail Offres d'emploi v2 | Hiring | FR (national official) | Free registration, OAuth client credentials | Per-offer check (404) | Built from docs; **needs credentials** |
| Greenhouse / Lever / Ashby public boards | Hiring | Any supported country (selected employers) | Open | Listing diff (+ per-job check for Greenhouse / Lever) | **Tested with real data**; owner adds employers |
| Careers pages (schema.org JobPosting) | Hiring | Any (selected employers) | Open; robots.txt respected | Listing diff + page check | Built from schema.org; depends on the employer publishing JobPosting data |
| Adzuna | Hiring (aggregator) | GB, DE, FR (partial) | API key; commercial use needs an agreement and attribution | None | Built from docs; **needs key + explicit owner opt-in** |
| TED Search API v3 | Procurement | NO, SE, DK, FI, DE, FR (above EU/EEA thresholds) | Open (anonymous search) | Deadline + TED ACTIVE-scope check | **Tested with real data**, enabled (scope: CPV 72, 48, 7934, 794, 796, 7931) |
| Find a Tender (OCDS) | Procurement | GB (national official) | Open (OGL v3) | Deadline + per-notice status | **Tested with real data**, enabled |
| Contracts Finder (OCDS) | Procurement | GB (partial, lower-value) | Open (OGL v3) | Deadline only | **Tested with real data**, enabled |
| BOAMP open data | Procurement | FR (national: MAPA / FNS; JOUE excluded to avoid duplicating TED) | Open (Licence Ouverte) | Deadline only | **Tested with real data**, enabled |

Evaluated but **not integrated** (also listed in the UI): Doffin API (NO, needs a subscription key), Hilma (FI, needs a subscription key), udbud.dk (DK, no verified API), oeffentlichevergabe.de (DE, access and terms not verified), Swedish commercial notice databases (paid), Jobnet (DK, no API), Työmarkkinatori (FI, API not verified), Bundesagentur für Arbeit Jobsuche (DE, community docs only), DWP Find a job (UK, no API), Reed (UK, aggregator, key).

### Operational status per country at delivery (open sources only)

| Country | Hiring | Service & project |
|---|---|---|
| Norway | Not configured (needs NAV token) | Partial (TED, above threshold) |
| Sweden | **Fully operational** (JobTech) | Partial (TED) |
| Denmark | Not configured (employer feeds only) | Partial (TED) |
| Finland | Not configured (employer feeds only) | Partial (TED) |
| Germany | Not configured (Adzuna needs key and agreement; employer feeds) | Partial (TED) |
| France | Not configured (France Travail needs credentials) | **Fully operational** (BOAMP + TED) |
| United Kingdom | Not configured (Adzuna needs key and agreement; employer feeds) | **Fully operational** (Find a Tender + Contracts Finder) |

The dashboard computes this live from feed health: "Fully operational" needs a national official source that is configured **and** syncing successfully.

## Activating the remaining integrations

1. **NAV (Norway, hiring).** Email `nav.team.arbeidsplassen@nav.no` with written acceptance of <https://arbeidsplassen.nav.no/vilkar-api>, plus a company identifier, contact email, phone and contact person. Put the token in `NAV_JOB_FEED_TOKEN`, restart, then use **Sources & settings → NAV → Enable**. The first run starts `initialDays` back (default 3). This adapter has not yet run with a real token; check the first run under **Sync health**.
2. **France Travail (France, hiring).** Create an account on <https://francetravail.io>, declare an application and subscribe it to "API Offres d'emploi". Set `FRANCE_TRAVAIL_CLIENT_ID` and `FRANCE_TRAVAIL_CLIENT_SECRET`, restart, and enable the source. Default scope is ROME codes M1805, M1806, M1810, M1802 and M1801 (IT and digital occupations). Check the first run under **Sync health**.
3. **Adzuna (UK / DE / FR, aggregator).** Register at <https://developer.adzuna.com>, then set `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`. Confirm with Adzuna that your use is permitted (commercial use beyond the trial needs an agreement). Then enable it and tick the terms confirmation. Records stay labelled third-party and unverified.
4. **Employer ATS boards and careers pages.** **Sources & settings → Add employer feed.** Enter the board token, the employer's official website and, optionally, the registration number or a Company Intelligence record. The board is verified against the official site automatically.
5. **Not yet integrated sources** (Doffin, Hilma, …) need a key or agreement and a new adapter implementing `OpportunityProvider`. Adding a country = one entry in `config/opportunity-countries.ts` plus provider coverage declarations.

## Known limitations

- TED, BOAMP and Contracts Finder do not report closure. Activity follows the published deadline (plus TED's ACTIVE scope and Find a Tender's notice status), and cancellations published as separate notices are not linked automatically.
- JobTech and NAV posters can be agencies; this is flagged by name heuristics and never confirmed as the employer, but detection is not exhaustive.
- Free-text ATS locations are attributed only when a supported country or major city is recognised; anything else is skipped and counted as "out of scope" in the run.
- No source in scope offers webhooks; everything is polled and labelled as such.
- Company linking needs Company Intelligence records with registration numbers or websites. No records match until the corresponding registry country is synced.
