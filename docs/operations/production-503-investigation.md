# Production 503 investigation — 7 November 2026

## Current status — RESOLVED: MongoDB Network Access Restriction

**Confirmed cause of POST /api/auth/login and POST /api/registry/sync failures: MongoDB Atlas Network Access Restriction.** The operator added `0.0.0.0/0` to Cluster0's Atlas IP Access List and verified that both Login and Sync Today immediately worked, without redeployment or database cleanup. This controlled production intervention establishes that the deployed application's outbound connections were blocked by the prior access list. It explains why localhost worked while Vercel failed. Storage pressure was a separate risk, not the confirmed cause of these API failures. The separately fixed connection-cache defect is not identified as this outage's cause.

Resolution evidence is the user's successful production login/sync tests reported in this conversation. This review does not claim an independent authenticated production test, private inspection of the production URI, or access to the former server-selection logs. No production POST/write probes will be repeated under the user's new read-only instruction.

The existing working network rule must remain until an approved replacement is tested. Broad access permits public IPv4 connection attempts; database authentication and TLS remain required. On the present Vercel Hobby + Atlas M0 setup, credential scope and secret protection are the immediate hardening priorities. See [the current security and storage review](./network-security-and-storage-plan.md) for current documentation, read-only findings, backup status, collection-by-collection cleanup scope and approval gates.

**Authorized cleanup subsequently completed:** after the user confirmed the production target and accepted the verified local backup, the agent removed 96,232 non-user business records and the separate 67,661-record sample database. All ten users and all 11 protected identity/security/configuration collections matched their original fingerprints. See [the complete cleanup result](./database-cleanup-result.md). No deployment or network-rule/credential change was performed.

**All unresolved/root-cause and no-cleanup statements below are historical investigation notes, superseded by this confirmed resolution and authorized cleanup.** They are retained as an evidence trail, not current status. Cleanup was preventive storage maintenance, not the outage repair.

## Follow-up with confirmed Atlas tier and cleanup authorization scope

The user reports Cluster0, M0 Free, 490.55 MB of 512 MB (96%). A refreshed read-only inventory remains consistent with that report: ExploreTechify data+indexes 364,387,421 bytes, sample_mflix 150,099,226 bytes, combined 514,486,647 bytes (490.65 MiB). Dashboard MB labels and byte accounting must not be confused with compressed allocation. The tier/limit are user-supplied; the actual deployment-to-cluster identity is not yet verified.

**Current storage exhaustion is not established:** a deliberately new, isolated auth-rate-limit diagnostic document was successfully inserted and read back in the configured database. It expires under the existing full TTL index; no existing security record, user or account field was edited. Before/after users fingerprints match. Evidence: `storage/backups/storage-audit/write-probe.json`. This shows write availability in the inspected database; it does not prove production uses this connection or establish production latency.

One synthetic invalid login against production at 09:06:19 UTC returned HTTP 503/UNAVAILABLE, request ID `bom1::iad1::drzq4-1794042379358-13e35059935b`. It used a reserved .invalid address and no real credentials. This request can perform only normal failed-login rate-limit/audit writes; no account was created or changed. The live failure remains reproduced and unresolved, with no deployment performed.

Read-only Vercel API metadata confirms deployment `dpl_HVSALDhNkW96jswNw294CGLtbzFb`, project `prj_itv54aMCERfnP1kmg3eb0FTE3FaH`, Ready, source metadata SHA `5d2131037a3ae7b9030d79925d42887b3cf3d241`. That source object is not available in this local checkout. MONGODB_URI is a sensitive variable present for production/preview; the API does not return a usable value. No secret was printed, pulled into an env file or stored. Connection identity comparison remains unknown, not equal. The user has been asked to privately compare cluster hostname and database name.

The cached current Vercel CLI 65.12.1 can query logs without linking the checkout when both --scope and --project are provided. A one-hour query exceeded the Hobby runtime-log retention; a 15-minute query succeeded but returned only a summary with zero runtime records. Thus no current MongoDB quota/timeout error has been obtained. Sanitized metadata only is recorded in `runtime-log-summary.json`; raw logs and secret values are not persisted. The usable read-only command shape is:

`node C:/Users/M.2/AppData/Local/npm-cache/_npx/67eb4586ca667318/node_modules/vercel/dist/vc.js logs --scope siddiks-projects-06015787 --project business-operator --deployment dpl_HVSALDhNkW96jswNw294CGLtbzFb --environment production --since 15m --limit 100 --json`

Vercel documents runtime log access and redeployment requirements for changed environment variables: [runtime logs](https://vercel.com/docs/logs/runtime), [environment variable management](https://vercel.com/docs/environment-variables/managing-environment-variables). Neither the deployment nor its production variables were changed.

**Separately confirmed code defect, now fixed:** `connectToDatabase` reused its fulfilled cached promise after the established Mongoose connection became disconnected. A regression test failed on the old code (zero calls to mongoose.connect) and passes with the fix. An established disconnected connection now invalidates its cache; initial concurrent connections still share their in-flight promise. This can leave queries buffering after disconnects, but its participation in the current live incident is unproven. Files: `src/lib/db/connect.ts`, `tests/db-reconnect.test.ts`.

Fresh complete verified backups of both databases are recorded in `storage/backups/storage-audit/full-2026-11-07T09-09-39-254Z/bundle.json`. All 52 application collections plus six sample collections passed BSON archive read-back, count/fingerprint comparison against source, and index/options comparison. This is a logical verified backup, not an atomic Atlas point-in-time snapshot. Writers and live backup equivalence must be checked again immediately before any approved deletion. The diagnostic TTL record can temporarily differ from the backed-up empty authratelimits collection until expiry.

`scripts/storage-backup.ts --include-sample` now verifies both database backups before marking the bundle complete. `scripts/lib/source-backup.ts` additionally checks collection metadata; its regression test verifies detection of an index change. No production restore was performed.

The read-only identity audit found 10 users (one OWNER, two ADMIN, two STAFF, one DIGITAL_MARKETER, four CLIENT), no missing or malformed password hashes, all client organizations present, and six accounts without emailVerifiedAt. Existing verification states, passwords, grants and memberships were preserved. No real account password was supplied, so existing-password correctness and live successful login are not verified.

The exact proposed identity-only reset is documented in [auth-preserving-cleanup-plan.md](./auth-preserving-cleanup-plan.md), plan ID `ca4ec93bbe3a2e39a03a8339ecc7f237a86fa57d1343a69a316d7e536cff9ea2`: preserve ten identity/security collections, empty 42 application collections (96,294 candidate records), and conditionally remove all six sample_mflix collections after confirmation that the sample users/session and database are unused. This is not an approval. It explicitly lists custom/client content losses that cannot be assumed regenerable. The narrower existing candidate plan protects 192 referenced/manual companies and proposes 57,839 companies/24,217 associated contacts for review. No cleanup is recommended as a confirmed outage fix while writes succeed and production identity/error evidence remains unavailable.

Follow-up validation: typecheck and lint of changed files passed. The real registry smoke check fetched two Brønnøysund rows for 6 November through the ingestion path, with no durable dataset count growth and unchanged user/assignment fingerprints. Its first invocation lacked the required tsx server-module condition and failed; the correct invocation is `node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/storage-live-smoke.ts`. The script now reports a sanitized failure stage instead of only a generic Error.

Current production checks at 10:03:52 UTC: homepage/login/status 200, anonymous auth/me 401, anonymous POST registry/sync 401. The latter confirms authorization rejection, not authenticated synchronization. Production login's reproduced 503 and authenticated registry synchronization remain unresolved/unverified; no owner session was forged and no real credentials were supplied.

Post-probe inventory at 10:01:38 UTC: document bytes unchanged at 330,759,261; authratelimits has zero documents, confirming the probe expired. Index allocation increased to 33,644,544 bytes; readable application+sample quota-accounted total is now 514,503,031 bytes (about 490.67 MiB). This illustrates retained allocation after expiry and is not cleanup savings.

Follow-up full regression: all **617 tests across 46 files passed**, including the reconnect regression, account/login/permission workflows, registry sync and storage boundaries, and backup archive/metadata verification. Typecheck and lint of changed files passed after the final diagnostic script edits. Git whitespace checks passed. A fresh `next build --webpack` completed successfully, including its TypeScript phase, all 327 static pages and build traces. Its TypeScript phase was unusually slow in this local environment; no production latency inference is made from that duration. An earlier follow-up test/build attempt stopped making progress locally and was stopped; its partial results are not reported as a pass. No database records were cleaned up, no TTL/index policy was changed, and no deployment was performed.

Final startup verification at 10:45:51 UTC (16:45:51 Asia/Dhaka) passed against the rebuilt artifact on localhost:3108: /, /login and /api/auth/status returned 200; /api/auth/me returned 401. Workers, automatic seeding and automatic MongoDB collection/index creation were disabled by the investigation-only preload. Requests were GET-only. The local verification server was then stopped. No real-account login or authenticated production sync success is claimed.

Remaining decisions/evidence: privately verify Vercel Production's actual MongoDB hostname/database (and database-user write privileges), obtain the failed-request runtime error or equivalent production evidence, and determine whether the requested broad data reset is intended despite custom/client content losses. Any eventual cleanup needs current backup revalidation plus final approval of its exact scope. Any deployment needs separate approval. A small successful diagnostic write does not rule out a large sync exhausting the remaining headroom; it rules out a blanket current write refusal in the inspected database at probe time.

---

The sections below record the preceding investigation, before this follow-up evidence.

Production root cause remains unconfirmed. No production records, indexes, secrets, hosting settings or deployments were changed during this investigation. Existing uncommitted storage work was preserved.

## 1. MongoDB storage status

Read-only inventory captured at 08:28 UTC (14:28 Asia/Dhaka), using the connection in the local environment. This establishes connectivity from this machine, not equivalence with Vercel's production connection.

| Database | Uncompressed data plus indexes |
| --- | ---: |
| ExploreTechify | 364,387,421 bytes (347.51 MiB) |
| sample_mflix | 150,099,226 bytes (143.15 MiB) |
| Readable application/sample total | 514,486,647 bytes (490.65 MiB) |

`admin` reports zero data/index bytes. Statistics for `local` are unavailable. The inventory only covers authorized databases; the Atlas tier, exact limit and full cluster visibility are not verified. `clusterLimitBytes` is deliberately null.

ExploreTechify alone contains 330,759,261 document bytes, 89,272,320 allocated document-storage bytes and 33,628,160 index bytes. Its allocated storage plus indexes is 122,900,480 bytes (117.21 MiB). **Compressed allocation is not the Free/Flex quota metric.** Atlas documents accounting based on uncompressed data plus indexes across the cluster: [Atlas storage FAQ](https://www.mongodb.com/docs/atlas/reference/faq/storage/), [Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/). Neither application-only statistics nor a successful read proves that writes are allowed.

| Application collection | Documents | Document bytes | Index bytes |
| --- | ---: | ---: | ---: |
| companies | 58,031 | 309,276,256 | 22,843,392 |
| contacts | 24,848 | 14,606,289 | 5,054,464 |
| established_companies | 3,941 | 3,930,026 | 823,296 |
| jobs | 5,347 | 1,555,920 | 708,608 |
| inboxitems | 3,112 | 926,358 | 348,160 |

There are 10 application users, 35 marketer assignments and zero auth-rate-limit documents. Clearing expired login buckets would not recover meaningful capacity. Existing TTL definitions cover auth rate limits, analytics, lookup cache and explicitly expiring email records; no TTL indexes were added or changed because enabling one can delete existing data.

Complete collection inventory: ignored local artifact `storage/backups/storage-audit/inventory.json`. The script reads statistics and collection metadata, not document contents.

## 2. Root cause evidence and limits

Confirmed code path: every login first connects to MongoDB and writes a shared authentication rate-limit bucket before password lookup. A MongoServerError with code 8000 and a space-quota message becomes HTTP 503/UNAVAILABLE. This behavior is reproduced with an injected quota error in the isolated test database, and the test verifies that user lookup never happens. Successful login also updates lastLoginAt and audits the event, so bypassing just the rate-limit write would not resolve exhausted capacity and would weaken security.

The earlier checked-in `authentication-regression.md` records a historical quota error (513 MB of 512 MB). That is historical evidence, not a current production runtime log. Current reads reveal substantial sample-database usage and a plausible capacity risk, but no current production quota error was obtained. No synthetic production login was sent because even an invalid login writes rate-limit/audit records.

Current production GET results:

| Path | Status |
| --- | ---: |
| / | 200 |
| /login | 200 |
| /api/auth/status | 200, signedIn=false |
| /api/auth/me | 401, UNAUTHORIZED |

These responses do not verify real-account login, authenticated pages, write availability or intermittent failures.

Vercel CLI inspection identifies deployment `dpl_HVSALDhNkW96jswNw294CGLtbzFb`, project `business-operator`, status Ready, created 29 October 2026 at 04:41:42 Asia/Dhaka, with exploretechify.com as an alias. Local commits include later 6 November database/503 work and the workspace contains additional uncommitted changes. A Ready status does not establish database health, and current local code must not be treated as the deployed code. Deployment source revision/environment equivalence was not verified.

The installed Vercel CLI is 34.1.14. Its runtime-log request for today's entries returned no records. It does not accept `inspect --logs`. No current build/runtime crash, OOM, timeout, DNS, authentication, network-allowlist or storage-quota log was available to attribute the reported production failure exactly.

Broader review: this is Next.js App Router with integrated API routes, standard next build/next start scripts and Node >=20.9.0. Production without MONGODB_URI refuses the local database fallback; development can start a local MongoDB. The local URI has an explicit database and successfully authenticates. Local DNS overrides are opt-in. Production environment values were not retrieved or compared. Origin checks can produce 403, and authorization can produce 401/403; those are distinct from the quota 503 path. In-process scheduler intervals are unsuitable as reliable serverless scheduling; the README already instructs Vercel/multi-instance users to disable them and use authenticated cron endpoints. Attachment storage currently writes to the local filesystem, requiring durable external storage for a serverless deployment. These are production suitability concerns, not confirmed causes of this login incident. No server resource metrics or reverse-proxy configuration were available.

## 3. Affected files

- `src/lib/api/handler.ts`: connection, shared rate limit and safe HTTP error mapping; now logs the precise database failure stage.
- `src/lib/auth/rate-limit.ts`: findOneAndUpdate/upsert before login handler; existing expiry index retained.
- `src/features/auth/service.ts`: password lookup, last-login update and audit.
- `src/lib/db/connect.ts`: local/production connection selection and timeout.
- `scripts/storage-inspect.ts`: current read-only inventory and corrected quota accounting.
- `tests/auth-errors.test.ts`: quota failure, no password lookup, safe diagnostic assertions.
- `tests/opportunities.test.ts`: explicit test-only opt-in for synchronization tests.

## 4. Fixes applied in this investigation

1. Corrected the inventory to distinguish allocated storage from Atlas data-plus-index usage and inspect other authorized databases. Added explicit database-name validation and collection sizes/counts for the additional databases. Missing quota/permissions are represented as unknown rather than assumed.
2. Added structured `[api.database]` diagnostics for configuration/capacity failures, including stage, duration, category and numeric error code. Credentials, URI, request body, user email and raw error message are excluded. Rate limiting and existing responses remain intact.
3. Extended quota regression assertions to verify safe diagnostics. Updated existing synchronization tests to explicitly opt in to the collection behavior paused by the pre-existing storage work; default-pause behavior remains covered separately.
4. Regenerated malformed ignored Next.js route types with `next typegen`, which cleared the initial TypeScript syntax errors. No generated types were committed or application routes changed.

The large existing transient-storage implementation was present before this investigation and is not presented as a new fix or a verified production deployment.

## 5. Database cleanup and recovery

No cleanup was performed. No currently measured business record is established as safe to delete. The previous candidate plan is historical and is not a deletion authorization: it lists 57,839 companies and 24,217 contacts subject to protected-reference checks. No age cutoff or current business-disposability review has been approved. Preserve these datasets, users, transactions, assignments and active work.

No application code/script reference to sample_mflix was found. That supports reviewing it, but does not prove that another application does not use it. Potential sample-data candidates, **only after ownership/use review, a verified backup, and explicit approval**:

| Collection in sample_mflix | Documents | Data plus indexes; upper-bound quota savings |
| --- | ---: | ---: |
| embedded_movies | 3,483 | 83,163,933 bytes |
| movies | 21,349 | 52,534,342 bytes |
| comments | 41,079 | 13,767,060 bytes |
| theaters | 1,564 | 480,903 bytes |

Combined upper bound is 149,946,238 bytes (143.00 MiB). Actual index/allocation savings depend on the approved operation; deleting documents does not guarantee that index files or physical allocation shrink. Preserve sample users (185) and sessions (1); no account/session deletion is proposed. No oldest-first selection has been approved, and sample records were not inspected for content. This is an inventory for review, not a ready-to-execute deletion plan.

An existing ExploreTechify backup manifest at `storage/backups/storage-audit/full-2026-11-06T20-16-06-139Z/manifest.json` records verified=true and 52 collections. Its present contents/live equivalence were not reverified here, and it does not cover sample_mflix. Before any cleanup: identify the actual deployed cluster, pause relevant writers, create and verify a fresh backup of the exact target database, agree exact IDs/criteria and protected references, obtain approval, then compare quota and physical allocation separately. MongoDB may reuse freed WiredTiger space without returning it to the filesystem; see the [MongoDB storage FAQ](https://www.mongodb.com/docs/v7.0/faq/storage/). No compact, repair, index drop, TTL change or collection drop was run.

## 6. Verification

- MongoDB: authenticated, read-only dbStats/collStats/listCollections/listDatabases succeeded; inaccessible statistics are marked unknown. No write probe was performed.
- Initial typecheck failed on malformed `.next/dev/types/routes.d.ts`; route-type regeneration and a subsequent typecheck passed.
- Final post-edit typecheck and full lint passed; a separate lint of all changed TypeScript files also passed. Git diff whitespace validation passed.
- Full regression run: 612 passed, 4 failed, 45 files, 616 tests. Three sync failures came from missing test opt-in; one diagnostic assertion ran with the earlier cached handler while files were being edited.
- After the test setup change and a fresh run: all 66 tests across auth-errors, opportunities and registry-storage passed. A second full-suite pass is not claimed.
- Turbopack build stalled at compilation and was stopped. A fresh `next build --webpack` completed successfully, including TypeScript checks, all 327 static pages and build traces. The successful webpack build does not establish that the default Turbopack build completes in this environment; no default build configuration was changed.
- Public production GET checks and deployment metadata are recorded above. Real-account HTTP login and production write/worker workflows were not exercised.
- Local production startup (`next start`) passed. With an investigation-only preload disabling workers, seeding, autoIndex and autoCreate, GET /, /login and /api/auth/status returned 200 and /api/auth/me returned 401. Evidence: ignored `storage/backups/storage-audit/production-build-get-checks.json`. Binding to 127.0.0.1 initially caused clean-English-URL self-redirects; binding the identical build to localhost resolved them. No routing code was changed. Use localhost for local smoke checks; this loopback-only result does not explain the live production 503.

## 7. Remaining actions and exact verification steps

1. In Atlas, select the cluster actually used by Vercel Production. Record its tier, configured byte limit, logical data/index usage for all databases and any quota alerts. Verify the connection's cluster and database privately in the two dashboards; do not paste credentials into logs/chat. Review whether sample_mflix is disposable across all applications.
2. In Vercel, open business-operator → Logs, filter Production and /api/auth/login, then inspect an actual failed login's function error and timestamp. Capture a redacted Mongo error code, stage and request status. A read-only CLI attempt supported by the installed version is:

   `vercel.cmd logs dpl_HVSALDhNkW96jswNw294CGLtbzFb --since 2026-11-07T00:00:00Z --limit 100 --output raw`

   This returned no records here, so use dashboard log access if it remains empty. The new structured stage logs require a deployment of the reviewed change before they can appear.
3. Review and validate the complete existing working tree before deployment; it includes substantial pre-existing changes. From this project in PowerShell:

   `node node_modules/tsx/dist/cli.mjs scripts/storage-inspect.ts`

   `npm.cmd run typecheck`

   `npm.cmd run lint`

   `npm.cmd test`

   `npm.cmd run build`

   `npm.cmd start -- --hostname 0.0.0.0 --port 3000`

   Inspect the inventory for database coverage and limits; it cannot retrieve the Atlas plan limit. Keep in-process workers disabled for serverless hosting and configure the documented authenticated external cron jobs. Do not run local startup with production workers enabled as a diagnostic read-only probe.
4. After a reviewed deployment/capacity fix, verify homepage/login/status, a real authorized login, expected role dashboard, logout and re-login, and the previously failing operation while collecting runtime logs. Login verification performs normal application writes and should be carried out with the user's authorization. Capacity upgrades and any production deletion require a separate explicit decision; neither was performed.
