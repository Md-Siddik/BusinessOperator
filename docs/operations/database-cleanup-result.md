# Authorized MongoDB cleanup result — 7 November 2026

**Post-cleanup functional verification is not complete:** the operator subsequently reported that Sync Today failed and logout did not work, preventing a fresh login test. These failures are being investigated. Anonymous probes returned logout 200 with session-clearing cookies, synthetic invalid login 401 and unauthenticated sync 401; those do not establish authenticated user success. No successful production login/sync claim is made after cleanup.

Read-only follow-up at 12:17:11 UTC confirms all ten users still match the backup on every stable identity/credential field. Only expected activity/session-version fields were excluded from this second comparison, because logout legitimately revokes sessions. Four actual OWNER `auth.logout` events were recorded at 12:11:56 UTC and the owner's session version changed, proving the server processed the operator's logout requests. The original session is therefore revoked; stale dashboard state is a possibility, not a confirmed explanation for every Sync Today failure. The operator was asked to test a fresh login in a private browser window and provide any visible error. No credentials were reset or sessions forged.

## Result

The authorized cleanup completed on the production target confirmed by the user: **ExploreTechify on the same Atlas cluster as Vercel Production**. It deleted **96,232 application business records** across **41 collections** and removed the unused **sample_mflix** database with **67,661 sample records**. Every business collection was empty at completion. New data created by later user syncs/tests is outside this historical cleanup and must not be deleted automatically.

All **11 protected collections** matched their complete pre-cleanup content fingerprints. All **10 application user accounts** remain intact, including IDs, profiles, emails, password hashes, roles, permission grants/provenance, verification/reset/invitation state, session versions and organization memberships. Six accounts that were already unverified remain unchanged. No password reset, role change, account activation or session invalidation was performed by cleanup.

The 70 country/provider configuration records were retained because Sync Today requires them to resolve configured countries. Suppression/security records, audit history and sequence counters were also retained; these small operational/security records are not imported company datasets. Uploaded files outside MongoDB were not deleted.

## Backup and authorization

The user explicitly accepted the existing verified local backup instead of an additional external destination, authorized removal of the identified non-user business data after safety checks, and confirmed that the Vercel Production cluster hostname/database match .env.local. No repeat approval was required.

Accepted full recovery point: `storage/backups/storage-audit/full-2026-11-07T11-43-11-802Z/bundle.json`. It contains all 52 application and six sample collections with compressed BSON archives, collection options and indexes. Archive read-back/count/SHA-256 verification, live source comparison and metadata comparison passed before cleanup. The agent preserved the original backup unchanged; execution journals and audit outputs are separate files. The logical backup does not contain Atlas-managed database-user credentials or Vercel secrets; those were unchanged.

Execution journal: `storage/backups/storage-audit/cleanup-execution-2026-11-07T12-02-04-046Z.json`. The executor verified target identity, complete collection coverage, backup metadata, current collection fingerprints and organization dependencies before its first mutation. It deleted only IDs read from verified application archives in bounded batches, not arbitrary new records. It retained application collections and index definitions. The separate sample database was fingerprint-checked again immediately before removal. Admin/local/config databases were untouched.

sample_mflix contained embedded_movies (3,483), sessions (1), movies (21,349), users (185), comments (41,079) and theaters (1,564). Its sample identity documents are unrelated to application login: the runtime auth models use the explicit ExploreTechify connection, and no runtime source references sample_mflix. The ten real application users were not in that database.

## Preserved collections

| Collection | Records unchanged at cleanup completion |
| --- | ---: |
| auditlogs | 14 |
| authratelimits | 0 |
| clientdeletions | 0 |
| counters | 2 |
| countries | 70 |
| deletedidentities | 0 |
| organizations | 6 |
| suppressionentries | 4 |
| systemsettings | 5 |
| User | 0 |
| users | 10 |

## Cleared application collections

| Collection | Records deleted |
| --- | ---: |
| casestudies | 3 |
| checkpoints | 1 |
| clientdocuments | 2 |
| clientservices | 6 |
| companies | 58,031 |
| contactrequests | 3 |
| contacts | 24,848 |
| conversations | 3 |
| crmactivities | 237 |
| dailyregistrationsnapshots | 308 |
| emailcampaigns | 0 |
| emailmessages | 206 |
| emailtemplates | 9 |
| established_companies | 3,941 |
| followups | 1 |
| inboxitems | 3,112 |
| jobs | 5,347 |
| leadassignments | 35 |
| lookupcaches | 0 |
| messages | 6 |
| notifications | 58 |
| opportunities | 0 |
| opportunityevents | 0 |
| opportunityfeeds | 8 |
| opportunitysyncruns | 0 |
| projects | 2 |
| projecttasks | 5 |
| providerusages | 0 |
| quotations | 1 |
| registrysyncs | 11 |
| servicepackages | 7 |
| services | 10 |
| supporttickets | 4 |
| translations | 0 |
| webanalyticsdailies | 15 |
| webconversions | 0 |
| webeventkeys | 4 |
| webpageviews | 4 |
| websessions | 2 |
| websiteaudits | 0 |
| webvisitors | 2 |

This authorized scope included client history, projects, messages, marketer assignments, custom services/templates and case studies. Those original business records are available in the backup; they were not assumed to be user authentication records. Public services/content may now be empty until the user adds new business content through the live website.

## Measured storage

Before cleanup: **514,493,732 bytes (490.66 MiB)** across the application and sample databases, measured by uncompressed data plus index allocation.

Latest read-only measurement after cleanup, at **2026-11-07T12:12:09.366Z**:

- Application logical document bytes: **48,145** (about 47.02 KiB).
- Index bytes: **97,308,672**.
- Data plus indexes: **97,356,817 bytes (92.85 MiB)**.
- Allocated document storage plus indexes: **207,499,264 bytes (197.89 MiB)**.
- sample_mflix is absent from listDatabases and has zero remaining collections.

Deleting records does not immediately shrink WiredTiger allocation; index allocation can also change while deletes/checkpoints settle. Free pages can be reused. No indexes were dropped, no compact/repair was run and no physical disk reclamation is claimed. Atlas's dashboard can lag these live statistics. The reported remaining data-plus-index usage is the observed measurement, not a promise that all allocated files shrink.

After the verified empty-business snapshot, the running application generated seven default service-package records, one new daily snapshot, two analytics rollups and normal security audit events. These are new runtime records, not restored historical data. Companies, contacts and jobs remained empty in this measurement. Newly generated records were not repeatedly deleted.

## Verification and limits

- All preserved collection fingerprints matched before any post-cleanup login/sync testing. All 41 business collections had zero records at execution completion.
- The cleanup regression test passed in an isolated database: unsafe identity deletion, changed source and corrupt recovery metadata were refused; successful cleanup retained users, organizations, country configuration and indexes. Typechecking and scoped lint passed. The prior application suite had 617 passing tests; it was not needlessly rerun for this database-only operation.
- Live HTTP checks at 2026-11-07T12:07:29.061Z: GET / = 200; GET /login = 200; GET /services = 200; GET /api/auth/status = 200; GET /api/auth/me = 401; GET /api/countries = 401; POST /api/registry/sync = 401. The anonymous sync 401 verifies authorization rejection, not an authenticated sync.
- The operator was asked to sign out/in with existing credentials and run Sync Today in the live browser. Authenticated results are pending; no real credential was requested or exposed and no session was forged. Do not infer successful real-account login solely from an anonymous 200/401 response.

No redeployment, production environment change, credential/role change, network-rule removal or application code deployment occurred. The confirmed original 503 cause remains **MongoDB Network Access Restriction**, resolved by the operator's access-list change. Keep the working rule until a replacement has passed testing. The separate security review recommends validated TLS and an application-scoped readWrite credential instead of the locally observed atlasAdmin credential; those role/credential changes remain unapplied.
