# Existing-account login investigation

The failure has been reproduced and its cause identified. Original-owner login is not yet restored: database capacity must be recovered before successful end-to-end verification.

## Root cause

Localhost's login API returned HTTP 500 before checking a password. The server log reports `MongoServerError: you are over your space quota, using 513 MB of 512 MB`.

Every login first writes its shared, durable rate-limit bucket. Atlas rejects that write when the cluster is full. Consequently user lookup, bcrypt verification, and session creation are never reached. The frontend then displayed its invalid-credentials fallback, hiding the infrastructure failure. This explains why otherwise valid existing credentials can all appear to fail without their hashes changing.

The API now maps this specific Atlas capacity error to HTTP 503 with a safe unavailable response. The form preserves network failures and uses a service-unavailable fallback for server errors. Rate limiting still fails closed; no security check is bypassed to work around storage exhaustion.

Storage inspection found approximately 320 MB of data and 54 MB of indexes in `ExploreTechify`; the quota applies to the shared cluster, not just this database. Its largest collection is `companies` (52,785 records). There are zero expired authentication-rate-limit records, so clearing expired login buckets cannot solve this incident.

MongoDB documents this error and the hard storage limit in its [Atlas storage FAQ](https://www.mongodb.com/docs/atlas/reference/faq/storage/).

## Required capacity recovery

Increase capacity of the existing Atlas cluster to preserve all data. This requires access to the owner's Atlas account and may incur hosting charges. Do not create a replacement owner, reset passwords, change `MONGODB_URI` to an empty database, bypass the durable rate limiter, or rerun account-setup scripts.

An alternative is an explicitly approved, backed-up cleanup of specific disposable data. No deletion is authorized or performed by this investigation. The account snapshot does not back up company/job data and cannot authorize deleting those collections. No exact cleanup list has been approved.

After capacity is available, rerun the private verifier and browser tests below. Configure Atlas storage alerts/headroom to avoid another full-cluster incident.

## Evidence

- The configured database is `ExploreTechify`. Its existing owner record for `abusiddik9994@gmail.com` is active, verified, and has a structurally valid bcrypt hash.
- Git history from the initial implementation through `66fb619` does not change password hashing, password comparison, database resolution, or email normalization. Passwords are not trimmed; email addresses are trimmed and lowercased.
- Audit history records credentials being set on October 25, 2026 (Asia/Dhaka), followed by successful owner logins on October 25. This does not prove what password the owner used, or that a later login succeeds.
- The earlier encrypted credential backup contains no password hash for the owner before that setup. It cannot restore an earlier owner password. Do not run the credential-rotation repair script to investigate a login failure.
- At inspection, the configured database's latest authentication audit event was October 28. The failed localhost login produced no credential-failure audit record because its rate-limit write failed first. An initial API read probe timed out during development compilation; a subsequent unauthenticated read returned the expected HTTP 401.
- A verified AES-256-GCM snapshot of the configured database's users and organizations is stored under the ignored `.data/account-access/` directory. Account identities, password hashes, roles, grants, organization relationships and verification state were compared in memory against it and were unchanged.

## Error-reporting changes

The login form used the invalid-credentials translation as the fallback for unexpected errors and HTTP 500/503 responses. Network errors were also replaced by that fallback. Therefore the displayed message alone could not identify a password rejection.

Login now distinguishes rejected credentials, network failures, and unavailable services. Backend infrastructure errors were already returned separately from credential errors; Atlas storage exhaustion now has an explicit HTTP 503 mapping and a sanitized operational log message. No credential validation, account data, or authorization policy was changed by this correction.

The previous automatic-verification workaround was removed: login must not silently set `emailVerifiedAt` on an existing account. It did not explain a failure on the already-verified owner record.

## Private verification

Run in your own interactive terminal from the repository root:

```powershell
node scripts/verify-existing-login.mjs --email abusiddik9994@gmail.com --origin http://localhost:3000
```

Enter the original password at the hidden prompt. Never put passwords in arguments, environment variables, chat, screenshots, or logs. The script prints only diagnostic results; it does not print passwords, hashes, response bodies, or cookies.

The script first checks the original password against the stored hash in the configured database. With `--origin`, a successful comparison is followed by actual API login, identity/role validation, protected-page access, session refresh, logout, signed-out access denial, and re-login. These API calls perform normal login auditing and session revocation. They do not reset passwords or change roles, grants, verification state, or account identities. The script compares those fields afterward. Omit `--origin` for a read-only password comparison without API login/logout.

Interpret results:

- `accountFound: false`: the configured database does not contain the requested identity. Identify the correct existing database; do not seed a replacement.
- `passwordMatchesStoredHash: false`: the supplied original password does not match that database's current bcrypt hash. Do not reset or replace it. Locate a verified known-working recovery point and compare records securely before proposing recovery.
- A matching stored password with a failed runtime login requires investigation of the running server's environment, selected database, API status, and logs. Restarting a development process may be needed after environment changes, but never change database configuration based on a guess.
- Only a `PASS` result verifies the API lifecycle with those original credentials. Browser page reload, access to the expected dashboard, logout and re-login must also be checked in the user's browser.

## Verification scope

Regression tests use isolated databases and synthetic credentials. They cover all six roles, case-insensitive/trimmed input email, password whitespace preservation, bcrypt format compatibility, wrong-password rejection, session refresh and revocation, protected routes, unchanged credentials, error reporting, and production configuration safeguards. An additional regression injects the exact Atlas quota failure into the durable rate limiter and verifies HTTP 503 with no user lookup. These tests do not establish that the user's original password works against the running localhost instance.

No production deployment was performed. Owner recovery remains unverified until the private verification and browser checks succeed.

Final automated checks: all 47 tests across `login-flow`, `auth-errors`, `auth-inquiries`, `api`, and `deleted-account-login` passed. Type checking, targeted ESLint, script syntax checking and Git whitespace checking passed. The fresh-process login test also passed outside the restricted sandbox. These are synthetic-account results, not a successful original-owner login.

A post-change request to the running localhost server timed out during development compilation, so the new HTTP 503 behavior is verified by the real-route regression test but not yet confirmed by a completed localhost HTTP response. The pre-change HTTP 500 and server quota error were reproduced directly.

## Changed files

- `src/lib/db/errors.ts`: identifies the specific Atlas storage-quota failure.
- `src/lib/api/handler.ts`: maps that failure to HTTP 503 and logs a sanitized operational message.
- `src/lib/api/client.ts`: keeps network/client errors distinct from server-error fallbacks.
- `src/components/site/auth-forms.tsx`: uses the corrected error mapping and unavailable message for login.
- `messages/en.json`: adds the unavailable login message, inherited as fallback by other locales.
- `tests/auth-errors.test.ts`: covers error reporting, production configuration safeguards, and quota failure before user lookup.
- `tests/login-flow.test.ts`: extends coverage to all six roles, historical bcrypt formats, email normalization, unchanged credentials, and preservation of verification controls.
- `scripts/verify-existing-login.mjs`: provides private, interactive verification of original credentials and the live API session lifecycle.
- `docs/operations/authentication-regression.md`: records evidence, results, limits and the recovery procedure.

The automatic verification block added during the earlier attempt was removed from `src/features/auth/service.ts`. Pre-existing unrelated changes in that file and elsewhere were preserved.
