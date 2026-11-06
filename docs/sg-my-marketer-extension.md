# Singapore, Malaysia and private marketer assignments

## Repository audit

The application uses Next.js App Router, React, TypeScript, Zod and MongoDB/Mongoose. There is no SQL ORM or database row policy; authorization is enforced by route guards and service queries. Country definitions derive from `config/jurisdictions.ts`. `features/countries/service.ts` creates runtime Country settings. Provider factories implement `CompanyRegistryProvider`; the common HTTP client handles throttling, exponential retries, Retry-After, timeouts and circuit breaking. `registry/sync.ts` performs idempotent imports, snapshots, logs and publication monitoring. The in-process scheduler starts through instrumentation; external deployments use the existing authenticated cron endpoints.

Company identity, registration date, publication date and discovery time are already separate. Company, Contact, SuppressionEntry, RegistrySync and DailyRegistrationSnapshot supply the existing data and contact provenance workflow. The reusable research engine already supports identity-matched websites/contact pages, public business contacts, MX and optional paid verification, review queues, budgets and suppressions. No parallel enrichment pipeline was added. Website discovery and paid enrichment still depend on the existing configured providers and their access terms; registry availability does not imply contact availability or consent.

LeadAssignment already has a unique `(companyId, recipientId)` index. Shared rows have a null recipient. Owner sending, explicitly granted `marketerLeads.view`, and Owner/Admin `marketerTable.manage` remain the access boundaries. The old recipient-to-shared migration is guarded against new explicitly private assignments.

## Verified source capabilities (4 November 2026)

| Country | Source | Actual publication | Access and limitations |
| --- | --- | --- | --- |
| Singapore | [ACRA open data](https://www.acra.gov.sg/resources/open-data-initiative/), [collection 2](https://data.gov.sg/collections/2/view) | Monthly, regardless of daily polling. Collection metadata returned 14 October 2026 as its last update during research. | Open data; optional `SINGAPORE_DATA_GOV_API_KEY`. Public unauthenticated API access has lower limits. The adapter spaces requests and uses the shared retry client. |
| Malaysia | [SSM e-CBID](https://www.ssm.com.my/Pages/Product/Corporate-and-Business-Information-Data-(CBID).aspx) | Supplier-dependent; no verified public daily discovery API. | Paid, customizable bulk data. The official page lists RM20/application and RM1/company/table, RM3/company/package, or RM10/company/all tables for ROC. Confirm the current quote, taxes, permitted fields and reuse conditions with SSM. This is not a subscription quote for an API. |

Singapore's adapter discovers the 27 dataset IDs using collection metadata, then uses the documented [download API](https://guide.data.gov.sg/developer-guide/dataset-apis/download-dataset). It streams CSV, caches by publication/ETag, filters actual incorporation dates, and identifies entities by uppercase UEN. Metadata/download preparation failures are errors, never empty success. Source timestamps are retained even when company values have not changed. Dataset schema and API behavior are fixture-tested; a complete live 27-file import has not been performed in this change.

ACRA supplies names, UENs, registration dates, entity status/type and business classifications/activity where present. The public dataset does not supply business email, phone, mobile, website, founder names or named directors. Addresses can be residential, so this connector deliberately withholds them, including from raw payloads. Missing values remain missing. Registered-office and operating-address distinctions cannot be safely filled without additional evidence.

The [Singapore Open Data Licence](https://data.gov.sg/open-data-licence) permits commercial and noncommercial reuse subject to its conditions, including attribution; personal data is outside its grant. The company workspace includes source/licence attribution. Preserve it in downstream products and redistributed exports. The [ACRA API Marketplace](https://www.acra.gov.sg/resources/eservice-tools-portals/api-marketplace/) offers subscribed entity/profile queries and uses business accounts/Corppass. A current daily discovery service, price and contract have not been verified. No speculative Marketplace endpoint or residential/officer lookup was implemented.

SSM company/business lookup portals are distinct from bulk discovery. The Malaysia adapter reads an operator-supplied licensed file; it is **not** a live SSM API, SSM's native file format, or a claim of daily upstream delivery. Obtain the licensed export, delivery schedule, current field definitions, commercial reuse rights and any provider API specification before automating supplier delivery. No CAPTCHA, portal session or paid access is bypassed.

## Malaysia setup and interchange format

Set server-only `MALAYSIA_SSM_EXPORT_PATH` to an absolute JSON file path and `MALAYSIA_SSM_EXPORT_AUTHORIZED=true` only after obtaining authorized data and permitted use. Publish the file atomically (write a new complete file and rename). Convert the supplier's actual format to this internal contract:

```json
{
  "sourceUrl": "https://www.ssm.com.my/",
  "publishedAt": "2026-11-01T00:00:00Z",
  "records": []
}
```

Each record requires `registrationNumber` (12 digits), `name`, and `registrationDay` (`YYYY-MM-DD`). Optional fields: `oldRegistrationNumber` (legacy numeric/check-letter identifier), `status`, `companyType`, `activity`, `industryCode`, and `businessAddress` with `street`, `city`, `region`, five-digit `postalCode`, and mandatory `confirmedNonResidential: true`. No invented example companies or contacts are included. Use the actual authorized source URL and source publication timestamp. Conflicting duplicate identifiers fail validation; exact duplicates collapse. Old-only records require an authoritative old/new identifier mapping before ingestion; never infer it from a name. All imports use the 12-digit identifier to avoid duplicate old/new identities. Names of persons and contact fields are excluded from this interchange; use the existing business-contact evidence/review workflow for permitted enrichment.

## Daily automation

Both providers recommend 1,440 minutes. Singapore uses `PERIODIC` freshness, Malaysia `UNKNOWN` until its delivery terms are established. `ensureCountries` creates Malaysia settings and upgrades unconnected Singapore catalogue settings without overwriting a working provider. Enable/select the providers under existing Settings → Countries; existing explicit settings remain authoritative. Country-specific manual sync uses the existing protected registry action.

Both use a 90-day registration lookback so monthly publications do not fall outside the former 14-day incremental cap. Their default batch budget is 100,000; an explicit `REGISTRY_MAX_PER_RUN` still wins and a truncated batch is reported partial. Registration histories older than the window need manual date-range backfill (maximum 92 days per request). Publication delays beyond 90 days and corrections to older entities need explicit backfill; this is not a whole-register change feed. Zero matching records are a valid completed sync. The scheduler must be running, or existing cron routes must be called with their configured authorization; no machine/service deployment was changed.

## Shared and individual delivery

`POST /api/lead-assignments` remains Owner-only with `leads.sendToMarketer`. A legacy `{companyId}` request sends shared. New requests accept `destinationType: shared|individual` and require `recipientId` only for individual delivery. `GET ...?eligible=true` returns active Digital Marketers holding the effective table permission. The existing modal offers both destinations and a searchable name/email recipient selector.

Bulk requests use `companyIds` (1–100) instead of `companyId`; results contain one explicit success/error per distinct company. Each assignment is an atomic upsert with an embedded initial history entry and the existing unique index; the bulk request is intentionally not all-or-nothing. Desktop and mobile registration rows provide selection checkboxes and a shared delivery modal for selected records. Partial failures remain retryable without duplicating successful assignments. Repeated deliveries are idempotent, withdrawn records reactivate, shared and different-recipient deliveries can coexist, and conflicting archived migration rows are rejected for manual review.

Ordinary marketers read shared rows plus their explicit private rows. Queries, summary counts and outreach writes enforce this on the server. An Admin with only table-view access sees shared rows, while the Owner and an Admin explicitly granted management permission can inspect all assignments in the management table. Ordinary marketers cannot request another recipient or all private assignments. No new export endpoint is introduced; existing company exports remain under their existing Owner-only company permissions. Marketer assignment data is never added to company exports.

Managers can filter shared/individual/by marketer and reassign an active individual record using the existing edit modal. Reassignment atomically changes recipient and appends the prior/new recipient IDs to history. Concurrent modification fails; an existing target assignment causes a conflict rather than overwriting it. The original company remains unchanged. A new recipient is validated against current account status and effective access. Shared behavior and existing historical records are preserved without a destructive backfill or index replacement. Old migration tooling will not merge rows marked `destinationType: individual`.

Assignment notifications use the existing notification service and target only authorized shared viewers or the selected recipient. Audit records include actor, company, destination, recipient and assignment ID; reassignment records include both recipients. The atomic assignment/history operation is durable before audit/notification side effects, following the existing service pattern. Notification delivery is best effort; there is no new distributed transaction/outbox guarantee.

## Privacy and operational dependencies

No outreach is initiated by importing or assigning a company. Existing marketing eligibility, suppression and opt-out controls remain in place. Public availability and technical email syntax/MX checks do not establish deliverability, marketing consent or permission to contact. Operators still need applicable Singapore PDPA/DNC and Malaysian PDPA checks before outreach; this change does not implement a national DNC lookup integration or a legal compliance certification. No restricted personal contacts, residential addresses or inferred identities are collected by these adapters.

External blockers: Malaysian supplier authorization, a licensed real export and delivery/conversion workflow; any subscribed daily ACRA feed requires separately verified service documentation, contract and credentials. Optional research/search/contact verification providers require the existing credentials and budget configuration. Full live imports and a visual browser/device review remain deployment verification tasks unless recorded below as executed.

## Validation

See the implementation report in the final response for executed command results. New suites `sg-my-assignments.test.ts` and `sg-my-sync.test.ts` use disposable MongoDB and explicit fixture sources. No production registry data or live database migration is used by tests.
