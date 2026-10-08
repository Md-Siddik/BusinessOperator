# ExploreTechify

**A European company intelligence system.** It finds newly registered companies, verifies who they are, finds genuine business contacts and checks them, suggests services that fit (evidence only), and helps you prepare quotations for **manual** communication and follow-up.

```
New registration → Verified identity → Business contacts → Verification → Service fit → Saved lead → Quotation draft → Manual contact & follow-up
```

Companies with a usable email or phone are always listed first. Companies without contacts stay visible and keep being researched on a bounded schedule. ExploreTechify uses **no** communication APIs: it never sends email, SMS or messages.

The same Next.js application also contains a multilingual public website, CRM, outreach with human approval, and a client portal with real-time chat. All of these are secondary to the daily company workflow.

---

## Quick start

Requirements: **Node.js ≥ 20.9** (tested with Node 24). No MongoDB or Docker is needed for development.

```bash
npm install
cp .env.example .env.local     # set AUTH_SECRET and DEMO_PASSWORD (≥ 10 chars)
npm run dev                    # http://localhost:3000
```

On first start:

1. A local MongoDB starts automatically (`mongodb-memory-server`, data in `.data/mongo`) when `MONGODB_URI` is empty.
2. With `SEED_DEV_ACCOUNTS=true`, development logins and a sample client workspace are created. **No companies are generated.**
3. About 15 seconds after boot, the workers start:
   - **Registry syncs.** Norway, Finland and Ireland need no key.
   - **Live feeds.** The Norwegian update feed is polled every 60 s.
   - **Free contact research.** It checks the registry and the company's own website. Paid providers stay off until you enable them and set a budget.

Sign in as `owner@demo.exploretechify.local` with `DEMO_PASSWORD` from `.env.local`. You land on **Today**: the companies registered today in the selected country.

Other development logins: `admin@`, `staff@`, `client@`, `client-b@` and `client-c@demo.exploretechify.local` (the last is pending approval). They exist only outside production.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server (starts the registry scheduler) |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` · `npm run lint` · `npm test` | Checks (`npm run check` runs all of them plus the build) |
| `npm run registry:verify [-- NO FI]` | **Live check** of the connected registry APIs: no database needed |
| `npm run registry:sync -- NO [today\|YYYY-MM-DD]` | Run a sync from the command line |
| `npm run seed` / `npm run seed:reset` | Seed an empty DB / wipe and reseed development accounts |
| `npm run migrate` | Run pending idempotent migrations (they also run automatically) |
| `npm run coverage:report` | Regenerate `docs/coverage/jurisdictions.md` from the catalogue |

---

## Data sources (real data only)

All 56 European jurisdictions are catalogued with:
- the official registry;
- the API or feed;
- what the registration date means;
- entity types;
- contact fields;
- update frequency;
- access requirements;
- permitted use;
- an **integration state**: Connected · Lookup only · Needs credentials · Needs approval · Under research · Provider error · No verified feed found.

See the **European coverage** page and [docs/coverage/jurisdictions.md](docs/coverage/jurisdictions.md). A country in the list is not an integration.

| Country | Adapter | Out of the box | Freshness | Evidence |
|---|---|---|---|---|
| 🇳🇴 Norway | Brønnøysundregistrene (search + update feed) | **Live, no key** | Search real-time; update feed in ~5-min batches (measured) | Freshness measured |
| 🇫🇮 Finland | PRH YTJ open data | **Live, no key** | Daily | Real-data tested |
| 🇮🇪 Ireland | CRO open data | **Live, no key** | Labelled daily; observed lag shown | Real-data tested |
| 🇬🇧 United Kingdom | Companies House REST + Streaming worker | 2 free keys | Current / streamed | Documented |
| 🇳🇱 Netherlands | KVK Mutatieservice + Basisprofiel | Paid KVK subscription | Near real-time (≤ 15 min per KVK) | Documented + KVK test environment |
| 🇪🇪 Estonia | RIK XML services | Agreement with RIK | Real-time services (to be measured) | Documented |
| 🇫🇷 France | INSEE Sirene | Free key | Daily | Documented |
| 🇩🇪 Germany | OpenRegister (commercial) | API key | Unknown until measured | Documented |
| 🇩🇰 Denmark | CVR | Credentials from Erhvervsstyrelsen | Continuous | Documented |
| 🇸🇪 Sweden | SCB Business Register API | Certificate from SCB, no adapter yet | Nightly | Needs approval |
| Other 46 | Catalogue + optional OpenCorporates fallback | — | — | Under research |

Contact-data providers (retrieval only): the company's own website (built-in), **Hunter**, **Apollo** and **Brave Search**, all behind owner-controlled budgets. See [docs/providers/contact-data.md](docs/providers/contact-data.md).

Setup, fields, rate limits and options per country are in **[docs/providers/](docs/providers/README.md)**.

These rules hold everywhere:

- **No fake data.** No endpoint is invented and no record is generated. A country without a connected source shows "No daily registration feed connected", not a count.
- **No silent fallback.** If a registry fails, the country shows *temporarily unavailable*, the time of the last successful sync and a Retry option. Stored data is never replaced.
- **Honest freshness.** Every company stores `source`, `sourceType`, `dataFreshness`, `sourceFetchedAt` and `sourceUpdatedAt`, and the UI shows them. Periodic data is never labelled real-time.
- **Demo mode is opt-in.** `DEMO_MODE=true` (development only, or with `ALLOW_DEMO_IN_PRODUCTION=true` set by the owner) enables fictional providers. Their data is labelled **DEMO** on every row and the page shows a **DEMO MODE** banner. `REAL_DATA_MODE=true` disables demo mode entirely.

---

## Contact research, ranking and the manual workflow

- **Research runs in the background** and never delays a company's appearance. It is a bounded sequence:
  1. registry re-check;
  2. the company's own website (homepage, Contact, About, Team, Impressum, legal notice) or verified website discovery;
  3. Hunter, Apollo or Brave if enabled and within budget;
  4. MX / Hunter verification.

  Retries come after 1, 3, 7, 14 and 30 days, or earlier on a registry change. Unsuccessful lookups are cached. The last 90 days are backfilled, newest first.
- **Every contact keeps its source, collection time and evidence.** Ownership is assessed separately (Confirmed, Likely, Uncertain, Intermediary or Group-level), and so is verification:
  - email: Source confirmed, Deliverable, Catch-all, Unknown, Invalid, Bounced;
  - phone: Published, Reachability confirmed.

  Ambiguous matches go to the **Review queue**. A provider's confidence score never verifies a contact by itself.
- **Contact-first ordering:**
  - Companies with at least one usable, owned email **or** phone sort first, then by contact quality, service fit, registration date and a stable id.
  - The ordering is applied in the database before pagination, so it holds in Today, country views, All Countries, search and exports.
  - Coverage counts a company with both email and phone once.
- **Three daily views:**
  - **Registered** uses the registry's own date.
  - **First received** uses when ExploreTechify stored the company.
  - **Contacts found** uses when the first usable contact was found.

  Research never changes a company's registration date.
- **Service fit** suggests packages only when evidence exists, for example "no website found after research (not proof none exists)", a weak audit, a hiring signal or a webmail address. You can accept, reject or edit each suggestion. Packages, prices and targeting rules are owner-editable (Settings → Service packages).
- **Outreach eligibility** is separate from availability: Needs review (the default), Cleared, Restricted or Do not contact, each with a reason and date.
  - Source restrictions (Danish reklamebeskyttelse, KVK non-mailing) and suppression always win.
  - Eligibility applies to drafts, exports and quotation recipients.
- **Quotations** are editable drafts:
  - The recipient must be an eligible, usable contact.
  - Prices come only from owner-approved package lines; missing ones stay as placeholders, and "Ready" is blocked until every price is filled in.
  - Download as HTML and print to PDF. Nothing is sent.
- **Manual follow-up:**
  - Record channel, date, response, next action and the follow-up task.
  - A phone-only lead can record an email given during the call.
  - Stages: New · Researching · Contact available · Qualified · Quotation drafted · Contacted · Replied · Meeting · Proposal · Won · Lost · Do not contact.
- **Research inbox:** newly contactable companies, verification changes, strong service matches and review needs. Items are deduplicated, and the volume is set in Settings → Research.
- **Live updates:** workers push events over the existing SSE connection. The Today page offers "Show updates" and refreshes on its own only when you are idle, so rows never move while you are clicking or reviewing.

Operations: [docs/operations/workers.md](docs/operations/workers.md) covers the worker runtime, restart behaviour, multi-instance setup and health checks.

## The daily workflow

**Today** (`/dashboard/today`, the first screen after login):

- **Country selector** (today's count shown per country) and **registration date** selector: Today (default), Yesterday, Last 7 days, This week, This month or a custom range.
- **Today's count**, with *with email*, *with phone*, *with website* and *fully contactable* (email + phone + website). Below that: yesterday, 7 days, this month, and a clickable 14-day **daily timeline**.
- **Source bar**: data source, source type, freshness, connection state, last updated, and the timezone used for "today".
- **Refresh** (re-read the database), **Sync today** (fetch now; runs in the background with live progress), optional **auto refresh** (real-time sources only, default off) and **Export CSV**.
- **Company table**, built for contact discovery: company, registration date, industry, location, **email, phone, website (actual values)**, contact person, data completeness and qualification.
  - Every value has **Copy**, and **Email / Call / Open** where relevant.
  - Missing values say *Not available from registry* (or *Not published by this registry*) and are never shown as a clickable icon.
  - Each value is labelled with its source: Registry, Website or Manual.
  - The header is sticky, columns can be hidden, wide tables scroll horizontally, and phones get cards.
- **Filters**: has email / phone / website / contact person, fully contactable, no contact details, industry or industry code, completeness, lead score, qualification, not contacted. Sort by registration date (default), completeness, score, industry, name, email-first or phone-first.
- **Drawer**: click a row to see contact, address, business activity, people and roles, data quality and source. **Previous / Next** (or ← →) moves through the day's list.
- **Quick qualification**: Relevant / Maybe / Not relevant, Save lead, and *Qualified lead* (adds it to the CRM).

**Company Intelligence Profile** (`/dashboard/companies/{country}/{id}`) has:

- **Header**: registration number with copy, registration date, country, industry, and the contact block.
- **Registration**: founding date, status, legal form, industry code and classification system, source registry.
- **Address**: business and postal address.
- **Business description**: activity and purpose.
- **People and roles.**
- **Contact sources**: every value with its source and verification state.
- **Source panel**: link to the official registry record, freshness, last fetched.
- **Navigation**: Previous / Next through companies registered the same day.
- **Actions**:
  - **Refresh from registry**.
  - **Find contact details**: re-check the registry, then verified website discovery, then contact extraction from the company's own site (robots.txt respected), then an MX check.
  - **Edit contact details**: saved as *Added manually* and never overwritten by syncs.
- **Existing tools**: CRM controls, follow-ups, website audit and outreach.

Other pages:

- **Data Sources**: provider status panel, capabilities, credentials status, Check now, and the full sync log (new / updated / skipped / failed / duration).
- **Overview**: today's count per country, plus what needs attention.
- **Research**: Companies (any date), Contacts (every value with its source) and Saved Leads.
- **Global search** in the top bar: name, organisation number, email, phone, website and address.

---

## Architecture

```
Official registries ──► Providers (src/features/registry/providers/*)
                          │   capability + freshness declarations, throttled HTTP client
                          ▼
                     Normalization (NormalizedCompany → merge with contact provenance)
                          ▼
   MongoDB: Company · Contact · DailyRegistrationSnapshot · RegistrySync · Country
                          ▼
     Today view · Research · Contacts ──► Qualification ──► CRM ──► Outreach ──► Client
```

| Piece | Where |
|---|---|
| Provider contract | `src/features/registry/types.ts` (`CompanyRegistryProvider`, `NormalizedCompany`, capabilities, freshness) |
| Providers | `brreg.ts`, `prh.ts`, `companies-house.ts`, `insee-sirene.ts`, `cvr.ts`, `not-connected.ts` (SE, DE), `mock.ts` (demo mode only) |
| HTTP client | `src/features/registry/http.ts`: per-provider throttling, retry with backoff (honours `Retry-After`), timeouts, circuit breaker |
| Sync engine | `src/features/registry/sync.ts`: `syncToday`, `syncDate`, `syncCountry` (incremental), per-country lock, background runs with progress, dedupe, roles, snapshots |
| Scheduler | `src/features/registry/scheduler.ts`, started by `src/instrumentation.ts`. On serverless or multi-instance setups, set `REGISTRY_SCHEDULER=off` and call `/api/registry/cron` with `Authorization: Bearer $CRON_SECRET`. |
| Country dates | `src/lib/dates/country-time.ts`: "today" in `Europe/Oslo`, `Europe/Helsinki`, …; timestamps are stored in UTC |
| Contact quality | `src/lib/company-fields.ts`: completeness weights (email 30, phone 25, website 20, contact person 15, address 10), source kinds, formatting |
| Daily views | `src/features/companies/{service,registrations}.ts`, `src/components/intel/*` |
| Enrichment | `src/features/intelligence/enrichment.ts` + `safe-fetch.ts` (SSRF-safe, robots.txt, MX check) |

**Key decisions**

- `registrationDay` (the registry's local calendar day, `YYYY-MM-DD`) decides "registered today". `createdAt` is import time and is never used for this.
- Deduplication is on country + source id and country + registration number. Unchanged records are detected by hash and counted as *skipped*.
- The raw provider record is stored in `sourceData` (`select: false`). Only administrators can read it, via `/api/companies/{id}/source`.
- Lead scoring is transparent and configurable, but **secondary**. It never changes the pipeline stage; qualification is a human decision.
- Marketing-protected companies (Danish *reklamebeskyttelse*) are flagged and excluded from outreach drafts and campaigns.
- Exports require the `companies.export` permission (owner and admins by default), are audited, rate-limited and protected against CSV formula injection.

### Stack

Next.js 16 (App Router, `proxy.ts`, instrumentation) · React 19 · TypeScript · Tailwind CSS v4 · MongoDB / Mongoose 8 · Zod 4 · jose sessions · SSE realtime · Vitest.

### Rest of the platform (unchanged, secondary)

Multilingual public website (en, de, no, sv, fi, da, fr); RBAC (Owner / Admin / Staff / Client, with per-user permissions); CRM pipeline and follow-ups; outreach with Draft → Review → Approve → Send, suppression and unsubscribe; client portal (projects, requests, tickets, documents); real-time client chat with attachments; notifications; analytics; audit log; settings. The internal dashboard is in English.

---

## Security and privacy

- **Server-side boundaries**: all provider calls and credentials stay on the server. RBAC is enforced in the service layer, with tenant isolation for clients; clients can never access company intelligence.
- **Request protection**: Zod validation on every input, rate limits, origin checks, CSP and security headers.
- **Audit log**: covers syncs, exports, qualification, edits and deletions.
- **Data minimisation**: only business-relevant fields are stored. Registry birth dates are not stored. French sole traders and opted-out units are skipped by default. Every contact value records its source.
- **Deletion**: deleting a company removes its data and can add its addresses to the suppression list (Do Not Contact).
- **Polite enrichment**: robots.txt is respected, private network addresses are blocked, requests have timeouts and size caps, and only the homepage and one contact page are read.

## Testing

`npm test` runs 115 tests in 7 suites. Most relevant here:

- **Contact-first ordering** with 50 registrations and 20 direct contacts: the direct-contact group is always on the first pages, all 50 stay visible, and coverage is 40% with a company that has both email and phone counted once.
- **Contact types**: email-only, phone-only, both, website-only, contact-form-only, masked, invalid and uncertain values; review approval; intermediary detection.
- **Ingestion edge cases**: enrichment moves a company into the direct group without changing its registration date; name collisions and foreign-domain emails; duplicate and replayed events; unknown dates; midnight boundaries; late-arriving registrations; Contacts found vs Registered.
- **Reliability**: incomplete pagination reported as partial; job retries, back-off and dead-lettering; budget pauses and per-company limits; lookup caching.
- **Companies House stream**: replay idempotency and timepoint commit.
- **Normalizers**: KVK (invalid dates, non-mailing, new vs continuation), CRO, and RIK, including XML entity safety.
- **Restrictions and workflow**: restricted and suppressed contacts withheld from exports; eligible-only quotation recipients with price placeholders; evidence-only service fit; client access blocked from research, inbox and quotations.

- **Today filtering**: in Europe/Oslo, by registry date, never by `createdAt`.
- **Timezones**: Oslo and London land on different days at 22:30 UTC.
- **Scoping**: Norway filtering never returns another country, and ALL must be explicit.
- **Sync behaviour**: idempotent re-sync (skipped), snapshots, a failing registry substitutes nothing, not-connected and missing-credential countries refuse to sync, demo providers are unavailable outside demo mode.
- **Provenance**: manual values survive syncs, and registry values are removed when the registry removes them.
- **Brønnøysund normalization**: tested on the real API record shape.
- **Display**: actual email, phone and website values are rendered with Copy / Email / Call / Open, and missing values render without links.
- **Export**: permission and CSV injection checks.
- **Existing coverage**: tenant isolation, chat, outreach and RBAC.

Live verification against the real APIs: `npm run registry:verify`.

## Deploying

1. Set `MONGODB_URI`, a strong `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `REAL_DATA_MODE=true`, `DEMO_MODE=false` and `SEED_DEV_ACCOUNTS=false`.
2. Add the registry credentials you have (`UK_COMPANIES_HOUSE_API_KEY`, `FRANCE_SIRENE_API_KEY`, `DENMARK_CVR_*`).
3. Run `npm run build && npm start`. On serverless or multi-instance hosting, set `REGISTRY_SCHEDULER=off` and schedule `GET /api/registry/cron` (e.g. every 15 minutes; each country still respects its own interval) with `CRON_SECRET`.
4. Create the first owner account, then the other users under **Users**.
5. To scale out, move rate limiting and realtime to Redis, and use shared storage for uploads.

## Known limitations

- **Live without keys:** Norway, Finland and Ireland. The UK, Netherlands, Estonia, France, Germany and Denmark adapters are built from documentation (and, for the Netherlands, checked against KVK's test environment), but they need credentials before their first authenticated run. Sweden needs an SCB certificate before an adapter can be written. 46 jurisdictions are still under research.
- **Ireland's CRO dataset** lagged its "daily" label by several days when tested.
- **Contact coverage on day one is low:** about 4–6% of new Norwegian companies have a direct contact. Coverage grows as research retries, and with paid providers once you enable them.
- **Hunter, Apollo and Brave** are implemented but untested against live accounts (no keys).
- **Per-event feed delay samples** for Norway accumulate only as new entities are published; the publication cadence itself was measured.
- Email delivery webhooks are not wired. Non-English website translations need native review.
