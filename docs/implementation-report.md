# Implementation report

## Authentication

Root cause: deletion hard-removed the User document, including the sole password hash. Password authentication could no longer find the identity. There is no external provider identity to recreate it from.

Deletion now retains minimal authentication continuity in DeletedIdentity, while removing the application account and retaining the existing cleanup/audit behavior. Valid returning credentials atomically create a fresh Staff ID with empty grants, no organization and no old assignments. Old session subjects cannot resolve to the fresh identity. Suspended identities remain blocked, including self-signup. Concurrent returns deduplicate through the unique email index. A later passwordless deletion explicitly clears any older saved hash. See [account-recreation.md](account-recreation.md) for retention and recovery details.

Migration: `2026-11-deleted-identity-v1` in `src/lib/migrations.ts`. Run `npm run migrate` before deployment. It creates the credential collection index; it does not alter existing administrative permissions or production records. No authentication environment additions are needed. No live database migration was performed here.

## Marketer delivery

The existing Owner-only permission remains authoritative. The confirmation modal offers the shared table or a searchable active eligible individual. Desktop/mobile selection supports multiple records. Delivery results identify the destination and count; partial failures remain retryable and successful assignments deduplicate. Existing shared requests carrying a formerly ignored recipient field retain their contract. Private listing, counts and status writes are scoped to the recipient or existing authorized management role. Shared rows cannot silently become private through reassignment. Existing history and per-record atomic upserts are retained. Bulk operations report per-record results rather than providing an all-or-nothing transaction; external audit/notification writes follow the existing service pattern.

## Singapore and Malaysia

The working tree includes ACRA monthly open-data ingestion and authorized Malaysian SSM-file ingestion through the existing registry scheduler, normalization, storage and deduplication pipeline. Country metadata includes SG/SGP and MY/MYS, postal patterns and administrative level labels. Malaysian addresses are trimmed and five-digit postcodes remain strings, preserving leading zeros. Singapore addresses remain withheld under the connector's existing residential-address policy; unavailable geographic subdivisions or contacts are not invented.

No country-level RBAC field exists in this application. Individual assignments support selected SG/MY work without broad company-directory grants. Shared-table access still carries the existing shared visibility; this is not a new country-restricted account system. Existing administrative grants are unchanged.

Setup: Malaysia requires a permitted supplier export converted to the documented interchange schema, `MALAYSIA_SSM_EXPORT_PATH`, and `MALAYSIA_SSM_EXPORT_AUTHORIZED=true`. Singapore's `SINGAPORE_DATA_GOV_API_KEY` is optional. The scheduler/authorized cron must run. See [sg-my-marketer-extension.md](sg-my-marketer-extension.md) for configuration and source limitations. No live complete ACRA import, licensed live SSM import or browser/device interaction review was performed.

## Files in the resulting change

- Authentication: `src/features/auth/service.ts`, `src/features/users/service.ts`, `src/models/DeletedIdentity.ts`, `src/models/index.ts`, `src/lib/migrations.ts`.
- Delivery: `src/app/api/lead-assignments/route.ts`, `src/features/marketer/service.ts`, `src/features/marketer/owner-table.ts`, `src/features/marketer/handoff-migration.ts`, `src/models/LeadAssignment.ts`.
- UI: `src/components/intel/send-to-marketer.tsx`, `src/components/intel/registrations-table.tsx`, `src/components/intel/company-drawer.tsx`, `src/components/intel/daily-workspace.tsx`, `src/components/marketer/marketer-leads-table.tsx`, `src/components/marketer/owner-leads-table.tsx`.
- Countries/ingestion: `src/config/countries.ts`, `src/config/jurisdictions.ts`, `src/features/countries/service.ts`, `src/features/registry/providers/acra-sg.ts`, `src/features/registry/providers/ssm-my.ts`, `src/features/registry/providers/index.ts`, `src/features/registry/normalize-helpers.ts`, `src/features/registry/sync.ts`, `src/features/registry/types.ts`, `.env.example`.
- Tests: `tests/deleted-account-login.test.ts`, `tests/marketer-delivery-api.test.ts`, `tests/sg-my-assignments.test.ts`, `tests/sg-my-sync.test.ts`, `tests/marketer-provisioning.test.ts`.
- Documentation: this report, `docs/account-recreation.md`, `docs/sg-my-marketer-extension.md`.

Country/private-delivery code already present in the working tree was preserved and reviewed alongside the additions in this session.

## Executed validation

- `npm.cmd run typecheck`: passed after final code changes.
- `npm.cmd run lint`: passed; focused ESLint also passed for the final changed backend/test files.
- `npm.cmd run build -- --webpack`: passed, including TypeScript and generation of 326 static pages. A subsequent shared-reassignment validation guard passed typecheck and its affected tests.
- Full `npm.cmd test`: 563 passed, 2 failed out of 565 in 36 suites. Both failures were corrected: the shared-reassignment validation response and an obsolete test expectation excluding the existing Admin viewer permission. No administrative permission was changed.
- Rerun `tests/marketer-provisioning.test.ts tests/intel-separation.test.ts`: all 22 passed after those corrections.
- Final `tests/deleted-account-login.test.ts tests/sg-my-assignments.test.ts`: all 9 passed, including the additional passwordless-identity case and stored leading-zero postcode assertion.
- `tests/marketer-delivery-api.test.ts`: passed, covering bulk partial results, retries, deduplication, private delivery and authorization denial.
- `git diff --check`: passed.

The entire suite was not rerun again after the final corrections; the affected suites were rerun successfully. All data-fetching assertions used explicit fixtures and disposable MongoDB, with no production records changed. Tests do not establish live source access or upstream publication completeness.

Credentials hard-deleted before this change cannot be recovered; an administrator must provision a new Staff account and initial password for those users.
