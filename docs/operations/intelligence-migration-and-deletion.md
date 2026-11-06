# MongoDB migration and application verification — 2026-11-06

The migration completed successfully. The local Next.js application is running at
http://localhost:3000 using the verified new Atlas database, ExploreTechify.
This report replaces the earlier DNS-blocked preflight status. Remote hosting was
not identified or deployed; the verified running instance is this local project.

## Migration results

| Item | Verified result |
| --- | ---: |
| Company Intelligence records migrated | 52,785 |
| Established-company records migrated | 3,941 |
| Registered users preserved exactly | 10 |
| Company contacts preserved | 21,633 |
| Organizations preserved | 6 |
| Essential collection types copied | 33 |
| Failed or skipped records | 0 |
| Historical Job Intelligence copied | 0 |
| Synthetic write-probe records committed | 0 |

The complete document contents, BSON types, IDs and counts were verified, and
source indexes/collection options were copied. All 10 user documents still matched
the source after application startup: passwords/hashes, roles, permission grants,
session versions and relationships were unchanged. All 10 hashes use compatible
bcrypt formats. No passwords were reset and no replacement users were created.

The old database was read only throughout this task. A final complete source
fingerprint pass confirmed no source changes during migration. Historical jobs,
analytics and disposable processing history were deliberately excluded. Essential
company daily summaries were retained for existing dashboard counts.

The selective copy created 33 collections. The destination already contained one
empty legacy User collection, which was left untouched. Normal application model
initialization and fresh support collections bring the runtime total to
52. No per-date, per-country, export or backup collections were added.

## Connection fixes

Node's default DNS resolver was 127.0.0.1 and refused Atlas SRV/TXT lookups. Public
resolvers returned the cluster records; all three hosts passed certificate-checked
TLS 1.3 tests. An authenticated standard/non-SRV connection also succeeded.

The application now configures BOTH callback and promise DNS APIs from
MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8. Updating only the callback API did not repair a
promise resolver loaded earlier by Next.js; the live HTTP test caught this and a
regression test now covers it. OS DNS and Atlas access permissions were not weakened.

The destination URI originally omitted a database name and selected test. Both the
prepared migration destination and active MONGODB_URI now explicitly select
ExploreTechify. The active URI was changed only after migration/data verification.
The connection helper refuses an implicit database. Credentials were never printed
or committed. The observed execution egress IPv4 was 49.213.32.221; successful live
connections establish that no further Atlas IP-access change is needed here.

The local server uses hostname localhost. Binding it to 127.0.0.1 triggered a
Next.js loopback rewrite/redirect issue; no application routes or designs were
changed to work around it.

Primary references: [Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/)
and the [Next.js loopback binding issue](https://github.com/vercel/next.js/issues/94745).

## Recoverable backup and rollback

The important source data is backed up in:

storage/backups/migration/source-1793912985580/manifest.json

The directory contains 33 gzip-compressed BSON archives (about 24 MB) plus a manifest
mapping filenames to collections, schema/index metadata, document counts and hashes.
Every archive was decompressed/read back and compared with the live source before
migration. BSON restore behavior, including IDs, dates, decimal/double types, Unicode
and password fields, was tested with synthetic data. The directory is restricted
to the Windows owner account and SYSTEM and is excluded from Git.

The old database remains the rollback source. To roll back after accepting new
writes, first pause writers and reconcile the new records; do not simply switch
back and lose post-cutover writes. Restore archives into an isolated database first
using scripts/lib/source-backup.ts readBackupDocuments, preserving IDs and restoring
the manifest's collection/index metadata. No automatic restore or source deletion
was performed.

Repeatable tools are available as db:backup-intelligence and db:migrate-intelligence.
Migration apply requires --source-frozen and --backup-manifest. The latter is
verified against the source before writes. --continue-business-errors allows up to
25 explicitly logged individual company/established-record validation/uniqueness
failures; user/configuration/integrity/network failures still stop. Actual run: zero failures.

## Storage measurements

| Measurement | Original source | Running destination snapshot |
| --- | ---: | ---: |
| Logical document bytes | 335,573,380 | 303,565,484 |
| Allocated document bytes | 112,930,816 | 71,622,656 |
| Index bytes | 57,090,048 | 24,428,544 |

Allocated documents plus indexes decreased by 73,969,664
bytes (43.5%) in this measurement. This includes
excluded historical processing data and newly rebuilt storage/index allocation.
All essential company fields, including the existing raw-record inspection data,
were retained. No production business field or unproven-redundant index was removed.
Logical size, allocation and Atlas quota/accounting are different measurements.

Normal collection workers are resumed against the new database. At the post-startup
snapshot there were 52,792 companies: the 52,785 migrated records plus
7 newly saved records. Established companies remained 3,941 and users remained
10. Job Intelligence started empty; its database write/read capability was verified
with a synthetic transaction that was rolled back. Counts/storage will grow with
ordinary new ingestion. Automatic development-account seeding remains disabled.

## Application verification

- Existing application company and established-company readers returned real migrated data.
- Company lists apply their existing visibility/event filters; all 52,785 records
  exist even when a filtered view displays a lower total.
- Existing Owner JWT signing, verification and database/session loading passed
  without issuing a browser cookie or bypassing the login API.
- Existing Excel-compatible CSV export was left unchanged and returned exactly
  9 records matching 9 selected database records, with no truncation.
- Actual Next.js homepage and login page returned HTTP 200. Database-backed
  /api/auth/status returned 200; anonymous /api/auth/me and deletion returned 401.
  A nonexistent synthetic login was correctly rejected with 401, rather than a
  database/DNS failure. No real user password was guessed or changed.
- Full automated suite: 608 tests across 43 files passed. After the final DNS fix,
  21 focused connection/auth/deletion tests passed, including the new promise-DNS
  initialization regression. TypeScript, full/targeted lint and production webpack
  builds passed; the final build generated all 327 static pages. git diff --check passed.
- Background workers were paused during backup/migration. No running local app,
  worker or project scheduled task was found before copying. Atlas current-operation
  monitoring is unavailable to this database user; full backup/source fingerprint
  verification was used to detect unexpected source changes. Source checks passed.

## Intentionally disabled and still pending

Daily permanent deletion remains disabled in the UI and backend. DAILY_BACKUP_DIR
is unconfigured because no deployment storage platform was identified. The private
local migration backup does not establish durable shared storage for a hosted
deletion service. Three mandatory confirmations, Owner authorization, exact
day/category/country scoping, stale-count/content rejection and verified backups
remain implemented and were tested only with disposable synthetic records.

Actual existing-user password sign-in is still unverified: the user's original
password was not supplied through a private interactive session. Sign in at
http://localhost:3000/login using existing credentials, or run the hidden-input
scripts/verify-existing-login.mjs verifier in a private terminal. Hash preservation,
session eligibility and the real login API's invalid-credential path have passed;
they do not substitute for that successful original-password test.

The resumed worker logged a mailbox polling error (Command failed). This is isolated
from database/list/export operation; mailbox provider access and real email delivery
are not claimed verified and no unrelated mail settings were changed.

There was no remote deployment or browser-driven visual verification. The migration
and core local application checks are successful; complete end-to-end verification
of every website feature is not claimed while the checks above remain pending.

Private evidence: report-1793914994374.json, destination-verification.json,
application-smoke.json, http-smoke.json and runtime-status.json under
storage/backups/migration. No Google Sheets integration was reintroduced.
