# Storage optimization report

Current incident update: the operator confirmed **MongoDB Network Access Restriction** as the cause of production Login/Sync 503 failures. Adding `0.0.0.0/0` restored both workflows without deployment or cleanup. The user subsequently authorized and confirmed the production target for an identity-preserving reset; that cleanup is now complete. Earlier unresolved/no-cleanup statements below are historical. See [the updated investigation](./production-503-investigation.md), [security review](./network-security-and-storage-plan.md) and [completed cleanup report](./database-cleanup-result.md).

## Database measurements and backup

The configured local environment connects to Atlas database `ExploreTechify`. It is reachable. This does not establish that the deployed application uses the same connection.

| Measurement | Before | After safe work (no cleanup) |
| --- | ---: | ---: |
| Logical document bytes | 330,770,255 | 330,770,255 |
| Allocated document storage bytes | 79,122,432 | 79,122,432 |
| Index bytes | 33,054,720 | 33,054,720 |
| Allocated storage plus indexes | 112,177,152 (106.98 MiB) | 112,177,152 (106.98 MiB) |
| Companies | 58,031 | 58,031 |
| Contacts | 24,848 | 24,848 |
| Established companies | 3,941 | 3,941 |
| Background queue records | 5,347 | 5,347 |
| Registered users | 10 | 10 |
| Marketer assignments | 35 | 35 |

These figures describe this database, not the entire Atlas account or its quota. No storage-quota explanation for production has been proven.

Full backup: `storage/backups/storage-audit/full-2026-11-06T20-16-06-139Z/manifest.json`. Its compressed BSON archives include all 52 collections, indexes and collection options. Each archive was decompressed and its document count and SHA-256 content fingerprint checked. Live collection fingerprints were compared before marking the manifest verified; a separate full verification also passed. Backups and diagnostic artifacts are ignored by Git. A backup restore was tested in an isolated database by the existing backup regression test; production was not restored or modified.

## Proposed cleanup, awaiting explicit approval

`storage/backups/storage-audit/cleanup-plan.json` lists 57,839 candidate company IDs and 24,217 associated contacts. It protects 192 companies with marketer, CRM, quotation, email, follow-up, saved/manual or reviewed-contact dependencies. All 35 marketer assignments, including history, remain protected. Users, credentials, roles, permissions, organizations, settings, suppression records and other essential collections are outside the proposed cleanup.

The 5,347 queue records are automatic contact research, not employment postings: 1,768 completed new-company jobs, 82 completed registry-change jobs, 3,471 queued new-company jobs, 24 queued registry-change jobs and 2 running new-company jobs. Their historical work is a cleanup candidate; preserve any newly requested manual work when recomputing the plan. The opportunity, opportunity-event and opportunity-sync-run collections are empty.

The 3,941 established-company records, 3,112 inbox items, checkpoints, sync history and daily snapshots were identified for review. They are **not** blanket deletion targets: keep existing old-company table data and count history until their functional dependencies and any replacement source windows are approved. No collection will be dropped.

Before any approved deletion, pause deployed writers, reverify the full backup against the current database, regenerate protected references and exact candidate IDs, and create a fresh verified backup if anything changed. Delete only approved IDs in bounded batches; remove related disposable contacts/queue records only where their company IDs belong to the approved set. Compare user/marketer fingerprints and storage statistics afterward. No deletion command has been executed or added to the diagnostic scripts.

## Implemented storage behavior

Registry companies and their contact provenance are held in bounded process memory (15-minute expiry, at most 20,000 rows per collection). Existing registry adapters and normalization remain in use. The existing model queries combine temporary and durable rows, preserving filters, sorting, pagination, counts, details and export formatting. No new database or paid service was introduced. `mingo` evaluates existing MongoDB query expressions in memory.

Date-window reads can refetch through the current provider when temporary data is missing. Country/day-based IDs permit a selected dated row to be refetched on another server instance. Source batch caps, access requirements and incomplete-source reporting still apply. An unbounded view reloads a bounded current source window, not all historical registry data; it cannot retain deleted historical datasets indefinitely. Missing/undated source records and provider failures remain subject to source availability.

Compact daily count snapshots and country health metadata remain durable. Sync history/audit metadata still exists for explicit syncs. The guarantee is that ordinary fetching does not persist company datasets, contact datasets, raw responses or automatic new-company research jobs; this does not mean all application metadata stops growing.

Sending a selected company to the Digital Marketer table persists its company fields without raw source data or source hash. Its assignment, notifications and existing permission checks continue through the existing workflow. Subsequent ordinary registry ingestion skips assigned companies so browsing cannot shadow their durable marketer edits. Existing marketer records were not changed.

Automatic registry/live-stream collection and automatic research backfill/retries are paused by default. Legacy automatic research queue entries are not claimed. Employment-feed enqueueing, queued execution and scheduled ingestion are paused by default. Explicit configuration can reenable collection later; the defaults do not depend on changing the user's `.env.local`.

## Verification

- Type checking and lint passed after the fixes.
- Full regression run: 611 passed, 5 failed across 45 test files. The failures exposed temporary-row ObjectId casting, uniqueness and deletion behavior. After corrections, the final focused regression pass completed successfully: all 60 tests across six files passed, including both previously failing files, company/date/contact queries, marketer delivery and backup integrity. A successful second full-suite run is not claimed.
- A final date-window coverage correction was additionally checked: all 26 company/date and storage tests passed; type checking passed again.
- The storage tests cover zero durable company/contact/job growth, unchanged export content, selected-only marketer persistence, queued employment-job pause and source refetch after process-memory loss.
- Live verification fetched two real Norwegian registry rows through the modified ingestion path. Company/contact/job/established-company counts were identical before and after. Full user and marketer-assignment content fingerprints also matched. Evidence: `storage/backups/storage-audit/live-fetch-verification.json`.
- Production build verification did not complete: both Turbopack and webpack stopped producing progress in this local environment and were stopped. A successful production build is **not** claimed.
- Git comparison shows no edits to application routes, UI components, public assets, translations, authentication implementation or configuration/design files. Export columns and formatter were retained. This is code-level evidence, not a claim that every production workflow was exercised.

## Production HTTP 503

Live `https://exploretechify.com/` and `/login` returned 200. Unauthenticated protected API requests returned 401. One login request for a deliberately nonexistent account returned 503 with `UNAVAILABLE`, reproducing the reported backend failure without using real credentials.

The active Vercel deployment is `dpl_HVSALDhNkW96jswNw294CGLtbzFb`. Read-only deployment inspection succeeded. Production variable-name inspection confirms a `MONGODB_URI` secret exists; its value and equivalence to the local database were not verified. The old CLI returned build logs; current runtime-log queries returned zero records. Current Vercel runtime log commands were checked against https://vercel.com/docs/cli/logs.

Automatic approval review rejected pulling production environment variables because it would copy production credentials and other secrets into a local file without explicit authorization. No secret pull or alternative retrieval was performed. Root cause remains **unconfirmed**, production login remains **unfixed/unverified**, and no deployment or hosting setting was changed. Approval to securely inspect production configuration, or accessible backend error evidence, is needed to continue that diagnosis. Successful real-account login and authenticated live fetching have not been claimed.

## Exact changed files

| File | Storage-related purpose |
| --- | --- |
| `package.json` | Add in-memory query dependency. |
| `package-lock.json` | Lock dependency installation. |
| `src/lib/db/transient-registry.ts` | Bounded temporary rows, stable IDs, existing query/update/delete compatibility. |
| `src/models/Company.ts` | Enable temporary company reads. |
| `src/models/Contact.ts` | Enable temporary provenance reads. |
| `src/models/EstablishedCompany.ts` | Enable temporary established-company reads. |
| `src/features/registry/sync.ts` | Replace dataset writes with temporary rows; retain normalization, contacts, counts and assigned records. |
| `src/features/registry/request-data.ts` | Request source windows and recover dated rows after memory loss. |
| `src/features/registry/refresh.ts` | Route source refresh through temporary ingestion. |
| `src/features/registry/scheduler.ts` | Pause automatic collection/research and unapproved overlap cleanup. |
| `src/features/registry/companies-house-stream.ts` | Pause continuous collection by default. |
| `src/features/registry/bulk-file.ts` | Expire complete source-file memory cache. |
| `src/features/registry/established.ts` | Stop automatic historical overlap deletion. |
| `src/features/established/service.ts` | Store fetched historical rows temporarily; preserve identity deduplication. |
| `src/features/companies/service.ts` | Load requested windows, recover details and score temporary rows without bulk writes. |
| `src/features/companies/registrations.ts` | Keep date counts and exports connected to requested source windows. |
| `src/features/companies/intel.ts` | Recover temporary detail rows on another instance. |
| `src/features/research/contacts.ts` | Classify/provenance temporary contacts without durable writes. |
| `src/features/research/engine.ts` | Avoid auto research queue/cache writes for temporary rows and durable raw source payloads. |
| `src/features/jobs/queue.ts` | Pause employment work and legacy automatic research claims. |
| `src/features/opportunities/sync.ts` | Pause employment collection/check entry points. |
| `src/features/marketer/service.ts` | Persist only the explicitly selected company for existing handoff. |
| `scripts/lib/source-backup.ts` | Optional complete-collection coverage with existing backup verification. |
| `scripts/storage-inspect.ts` | Read-only size/count inventory. |
| `scripts/storage-backup.ts` | Full verified backup; no database writes. |
| `scripts/storage-cleanup-plan.ts` | Read-only reference-aware candidate plan. |
| `scripts/storage-live-smoke.ts` | Real source ingestion and unchanged-storage/user/marketer verification. |
| `tests/registry-storage.test.ts` | Meaningful storage-boundary regression coverage. |
| `docs/operations/storage-optimization-report.md` | Findings, evidence, limitations and approval plan. |

No production deletion, production configuration change or deployment has been performed.
