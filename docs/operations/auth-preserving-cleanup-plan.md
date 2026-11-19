# Proposed identity-only reset — NOT APPROVED

**Historical proposal, superseded by the user's subsequent explicit identity-only cleanup authorization and [completed cleanup result](./database-cleanup-result.md).** The executed scope preserved 11 collections, including required country/provider configuration, and cleared 41 business collections after backup/target verification. The old 42-collection plan ID below was not executed verbatim. The original 503 incident was resolved separately by the operator's Atlas IP access-list change.

Plan ID: `ca4ec93bbe3a2e39a03a8339ecc7f237a86fa57d1343a69a316d7e536cff9ea2`. Inventory: 2026-11-07T09:17:24.959Z. This is a review document, not permission to execute. No destructive script has been added or run. Production cluster equivalence and the storage cause are still unconfirmed.

## Exact scope requested for review

This is the broad identity-only reset requested by the user. It would preserve all records in the ten collections below, empty all records in the other 42 application collections, and remove the entire sample_mflix database only after the user confirms it is unused. No application database or authentication collection would be dropped. Application collection options and indexes would remain; emptying records does not guarantee that physical allocation or index allocation shrinks.

**This scope also erases custom website content and real client/workspace history.** Those records are not all caches and cannot all be reconstructed from registry sources. The verified backup is their recovery source. In particular services, case studies, templates, inquiries, client projects, messages, files' database metadata, quotations and marketer assignments would disappear. This scope needs specific acknowledgment in final approval; a general approval to remove regenerable registry data does not authorize those losses. The safer reference-aware registry-only alternative is recorded separately in cleanup-plan.json and preserves dependent workspace records.

## Preserve every record and field

| Collection | Records |
| --- | ---: |
| auditlogs | 12 |
| authratelimits | 0 |
| clientdeletions | 0 |
| counters | 2 |
| deletedidentities | 0 |
| organizations | 6 |
| suppressionentries | 4 |
| systemsettings | 5 |
| User | 0 |
| users | 10 |

Preservation includes names, emails, complete password hashes, roles, grants and grant provenance, statuses, verification/reset/invitation fields, session versions, profiles, organization memberships, security settings, suppression rules and security audit history. Preserve external AUTH_SECRET, MONGODB_URI and email-provider settings unchanged; these secrets are not stored in this report or the MongoDB backup. Client users depend on organizations for authentication/authorization, so organizations must remain. All four client accounts have a matching organization. There are currently no company references in the preserved organizations. No existing account will be verified, activated, recreated, reset or otherwise edited as part of cleanup.

The identity audit found ten application users, all with present bcrypt-formatted hashes; six currently lack emailVerifiedAt. Preserve those six accounts and their existing verification state. Format validation does not prove that a supplied password matches, and no real password was supplied to this investigation.

## Application collections to empty under this exact broad plan

| Collection | Records |
| --- | ---: |
| casestudies | 3 |
| checkpoints | 1 |
| clientdocuments | 2 |
| clientservices | 6 |
| companies | 58,031 |
| contactrequests | 3 |
| contacts | 24,848 |
| conversations | 3 |
| countries | 70 |
| crmactivities | 237 |
| dailyregistrationsnapshots | 307 |
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
| registrysyncs | 10 |
| servicepackages | 7 |
| services | 10 |
| supporttickets | 4 |
| translations | 0 |
| webanalyticsdailies | 15 |
| webconversions | 0 |
| webeventkeys | 2 |
| webpageviews | 2 |
| websessions | 1 |
| websiteaudits | 0 |
| webvisitors | 1 |

Total candidate records: 96,294. Measured logical document bytes: 330,742,040 (315.42 MiB). This is an upper-bound document-volume reduction for the full scope, not a promise of physical disk savings. Indexes are retained. If any content-review collection is retained instead, preserve its company/contact/dependent references and regenerate an exact narrower plan; do not delete all companies while keeping assignments, quotations or other referencing records.

Deleting services while retaining migration markers leaves the public service catalogue empty; the existing catalogue implementation does not automatically restore customized services. Deleting countries removes configured sync sources until they are explicitly restored/regenerated. Those are additional reasons this identity-only scope must not be mistaken for a feature-preserving cache cleanup. Uploaded files on disk/object storage are outside this MongoDB plan and would not be deleted.

## sample_mflix — conditional full database removal

| Collection | Records |
| --- | ---: |
| embedded_movies | 3,483 |
| sessions | 1 |
| movies | 21,349 |
| users | 185 |
| comments | 41,079 |
| theaters | 1,564 |

Measured data plus indexes: 150,099,226 bytes (143.15 MiB). This includes 185 records in sample_mflix.users and one sample session, separate from the ten protected application users in ExploreTechify.users. The user must confirm these are disposable sample identities and that no other application uses this database before its deletion can be approved. No application code reference to sample_mflix was found; that alone is not proof of exclusive ownership.

## Verified backup and execution gates

Both databases are fully backed up under `storage/backups/storage-audit/full-2026-11-07T09-09-39-254Z`, with individual manifest.json files and a verified bundle.json. All 58 collections passed compressed-BSON read-back, document count/SHA-256 comparisons against the live source, and index/options comparison. The backup is ignored by Git and contains credentials/hashes inside protected archives; do not publish or commit it. It is not an Atlas point-in-time snapshot. Pause writers and reverify the backup immediately before any approved deletion, refreshing it if data or metadata changed. A disposable TTL write probe can temporarily make the authratelimits snapshot differ until its own diagnostic record expires.

Required before destructive work:

1. Privately confirm the actual deployed cluster/database and establish current production failure evidence.
2. Resolve whether the broad identity-only losses above are intended or select a narrower registry-only plan; regenerate that exact scope and dependencies.
3. Pause deployed writers/background workers; verify a current backup of the exact target and fingerprint every preserved collection.
4. Obtain explicit final approval naming the exact plan ID and acknowledging the content losses and sample identity removal. The current task message is not that final approval.
5. Only then remove the approved records. Do not modify any preserved account/security document or external secret.
6. Compare preserved collection fingerprints, inspect dbStats/collStats and Atlas quota independently, exercise a disposable write probe, and verify real login plus registry synchronization against live endpoints. No production success may be claimed from local tests alone.

No deletion, index removal, TTL change, compaction, database drop or deployment has occurred.
