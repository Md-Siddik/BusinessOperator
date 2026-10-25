# Verified authentication and client inquiries

Implementation date: 25 October 2026 (Asia/Dhaka).

## Delivered code

The existing Next.js/Mongoose application, custom bcrypt authentication, layouts, components, chat service and design tokens are retained.

- Signup requests name, email and password. Optional legacy business fields remain accepted by the server for compatibility.
- Six-digit email codes expire after ten minutes, permit five durable attempts and have a sixty-second resend cooldown. Codes use a keyed HMAC in MongoDB and are redacted from transactional email history. Consumption is atomic and single-use.
- Chat requires verified email. The floating chat embeds login/signup/verification and preserves the draft in component state throughout authentication. A revoked session returns to authentication without discarding the draft. Drafts do not survive a full browser reload.
- All verified accounts, including Owner and Super Admin, sign in with email and password. Login never generates or sends a code. Unverified accounts resume registration using their original code or an explicit, rate-limited resend. Legacy challenge consumption remains separate from ordinary login; authenticator apps, passkeys and recovery codes are not implemented.
- Cookies remain HTTP-only, Secure in production and SameSite=Lax. The header restores status before showing navigation and displays a profile menu. Sessions last seven days, renew through a guarded POST endpoint on navigation/focus, and have a thirty-day absolute lifetime. Logout revokes all sessions using the account's session version.
- Signup/login/verification/reset/contact rate limits use shared MongoDB request budgets with TTL cleanup; other existing application limits keep their existing implementation.
- Public inquiries persist without signup. A verification link proves email ownership before private replies can be sent. Verified client sessions can claim unlinked inquiries matching their email; other clients cannot access them.
- Inquiry pages provide search, filtering, pagination, all original form fields, status changes, replies, quotation details, response history and client accept/reject controls. Existing notification counts remain in use; inquiry lists also show the number of NEW inquiries.
- Quotations store amount, currency, scope, delivery estimate, payment terms and notes. Email acceptance/failure is recorded separately from persistence. Provider acceptance is never described as delivery.
- Super Admin uses the existing ADMIN enum value and /staff workspace. It can manage inquiries, public services, website content, projects/chat, STAFF accounts and administrative summary reports. It cannot assign OWNER/ADMIN roles, revoke privileged users, or access owner-only intelligence/outreach modules.
- No Google OAuth integration existed in this custom authentication stack. Google sign-in has not been enabled.

## Database changes

Additive User fields: emailVerifiedAt, verificationActivates, invitationTokenHash/invitationExpiresAt, authCodeHash/authCodeExpiresAt/authCodeSentAt/authCodeAttempts/authCodePurpose, and mfaChallengeHash. Password hashes are absent for invitation-only identities until the invitee chooses a password. Existing hashes are preserved.

Additive ContactRequest fields: userId, emailVerifiedAt, verificationTokenHash/verificationExpiresAt, submissionKey, timeline and embedded responses/quotations. Legacy inquiry status values remain readable alongside NEW, UNDER_REVIEW, QUOTATION_SENT, IN_DISCUSSION, ACCEPTED, REJECTED and COMPLETED.

The AuthRateLimit collection holds hashed per-IP fixed-window budgets. Migrations 2026-10-verified-inquiries-v1 and 2026-10-auth-budget-v1 create inquiry ownership/idempotency/email indexes and rate-limit expiry indexes. No migration marks an existing email verified or deletes business records.

## Account inventory and rollout

The configured database initially contained seven demo identities. None of the requested email identities existed. Three invitation-only identities have been prepared:

| Email | Stored role | Destination | Current state |
| --- | --- | --- | --- |
| abusiddik9994@gmail.com | OWNER | /dashboard | PENDING_APPROVAL; password and email verification pending |
| abusiddick84@gmail.com | ADMIN (Super Admin) | /staff | PENDING_APPROVAL; password and email verification pending |
| careerhelp84@gmail.com | CLIENT | /portal | PENDING_APPROVAL; password and email verification pending |

No passwords were invented. No email verification status was fabricated. No invitation emails were sent from this workspace because NEXT_PUBLIC_SITE_URL points to the production domain and the acceptance route must be deployed first.

Deployment sequence:

1. Deploy these changes to the configured website.
2. Run the migration command below in that deployment environment.
3. Run the invitation command below. A live email provider is required; the command reports acceptance/failure per account and never prints invitation tokens.
4. Each recipient opens their single-use, twenty-four-hour link and chooses a password. Invitation acceptance establishes email ownership. Subsequent sign-in uses email and password. Verify all three dashboards before applying cleanup.
5. Generate and review a fresh impact report, then run --apply. The script checks the reviewed suspension list and the verified Owner identity, verifies an AES-256-GCM encrypted account/organization backup, assigns the retained roles, suspends the seven other application accounts, and revokes their sessions. It retains all linked records.

Exactly three ACTIVE application accounts is therefore pending invitation acceptance and the reviewed suspension step. Public client signup remains available as requested; future verified client registrations can increase this count.

Commands:

    npx tsx --conditions=react-server scripts/migrate.ts
    npx tsx --conditions=react-server scripts/account-access.ts --invite
    npx tsx --conditions=react-server scripts/account-access.ts
    npx tsx --conditions=react-server scripts/account-access.ts --apply

The local inventory/impact report is .data/account-access/impact-report.json (ignored by Git). Suspension candidates are admin@demo.exploretechify.local, client-b@demo.exploretechify.local, client-c@demo.exploretechify.local, client@demo.exploretechify.local, owner@demo.exploretechify.local, staff2@demo.exploretechify.local and staff@demo.exploretechify.local. The report contains their exact IDs and known-reference impact counts. Shared organization records are not exclusively owned by any one user.

No account access has yet been changed by --apply. No permanent deletion is implemented or proposed; the permanent deletion list is empty. A future deletion requires an explicit approved identity list, an encrypted full database dump, a tested restore, reference/retention review and preservation or reassignment of every linked business record. The encrypted account snapshot used for reversible suspension is not a substitute for that full backup. Preserve its AUTH_SECRET securely for recovery; never commit either secrets or backups.

Existing unverified accounts must verify ownership before chat or other authenticated APIs work. Old privileged cookies require fresh second-factor sign-in. This intentionally tightens prior access.

## Required provider settings

Existing settings are reused; no new service secrets are introduced:

- MONGODB_URI: the intended database.
- AUTH_SECRET: at least 32 characters; required for cookies, OTP HMACs, rate-limit hashing and encrypted suspension backups.
- NEXT_PUBLIC_SITE_URL: the reachable HTTPS deployment where the new invitation, inquiry-verification and reset pages exist.
- EMAIL_PROVIDER=zoho-smtp with ZOHO_SMTP_HOST, ZOHO_SMTP_PORT, ZOHO_SMTP_SECURE, ZOHO_SMTP_USER, ZOHO_SMTP_PASSWORD and EMAIL_FROM_ADDRESS. EMAIL_FROM_NAME is optional. The sender must be permitted by the Zoho account; configure the domain's SPF/DKIM/DMARC with the mail provider.
- Alternative existing providers: EMAIL_PROVIDER=resend or sendgrid, EMAIL_API_KEY and EMAIL_FROM with a verified sender.

The checked workspace has MongoDB, AUTH_SECRET, the site URL and Zoho SMTP variables populated. Their presence is confirmed; real SMTP acceptance and delivery have not been tested. Console/simulated email cannot verify an identity.

## Verification and limitations

Automated tests use isolated temporary MongoDB databases and a fake live email transport; they never send mail to the requested Gmail accounts. Tests cover minimal signup, duplicate signup, verification expiry/attempt lockout/replay/concurrency, second-factor bypass prevention, session revocation/absolute expiry, invitation acceptance, role escalation denial, inquiry ownership and direct API boundaries, email failure reporting, quotation acceptance and response notifications.

Real mailbox delivery, browser-restart persistence, and desktop/mobile visual interaction require a deployed browser smoke test. No browser automation tool is configured in this workspace. New workflow controls use existing responsive styles and semantic form elements.

Failed/unknown email submissions remain recorded for review; there is no automatic email resend worker. Inquiry verification links expire after twenty-four hours; an authenticated client can prove ownership by verifying its account, or the visitor can resubmit after expiry. New workflow text includes English controls within the existing localized site; additional translations remain to be supplied.


## Checks executed

- npm run typecheck: passed.
- npm run lint: passed with no errors or warnings.
- npm test: all 385 tests passed in 19 files.
- Focused authentication/inquiry/API tests: passed as part of the complete suite.
- Both new database migrations: applied successfully against the configured database.
- Account preparation and refreshed inventory: completed successfully; no suspension/deletion applied.
- npm run build -- --webpack: passed, including TypeScript and generation of all 315 static pages. The default Turbopack run compiled successfully after 9.9 minutes but was interrupted before completing its later stages; Webpack completed the full production build.
- git diff --check: passed.

## Files changed

- docs/operations/authentication-inquiries.md
- messages/en.json
- scripts/account-access.ts
- src/app/(app)/dashboard/inquiries/[id]/page.tsx
- src/app/(app)/dashboard/inquiries/page.tsx
- src/app/(app)/dashboard/layout.tsx
- src/app/(app)/portal/(workspace)/inquiries/[id]/page.tsx
- src/app/(app)/portal/(workspace)/inquiries/page.tsx
- src/app/(app)/portal/(workspace)/layout.tsx
- src/app/(app)/staff/inquiries/[id]/page.tsx
- src/app/(app)/staff/inquiries/page.tsx
- src/app/(app)/staff/layout.tsx
- src/app/(app)/staff/reports/page.tsx
- src/app/(app)/staff/users/page.tsx
- src/app/(site)/[locale]/(auth)/accept-invitation/page.tsx
- src/app/(site)/[locale]/(auth)/verify-inquiry/page.tsx
- src/app/api/admin/users/[id]/route.ts
- src/app/api/admin/users/route.ts
- src/app/api/auth/invitation/route.ts
- src/app/api/auth/login/route.ts
- src/app/api/auth/logout/route.ts
- src/app/api/auth/refresh/route.ts
- src/app/api/auth/resend/route.ts
- src/app/api/auth/status/route.ts
- src/app/api/auth/verify/route.ts
- src/app/api/contact/route.ts
- src/app/api/inquiries/[id]/route.ts
- src/app/api/inquiries/route.ts
- src/app/api/inquiries/verify/route.ts
- src/components/chat/chat-widget.tsx
- src/components/site/accept-invitation.tsx
- src/components/site/auth-button.tsx
- src/components/site/auth-forms.tsx
- src/components/site/contact-form.tsx
- src/components/site/quick-auth.tsx
- src/components/site/verify-inquiry.tsx
- src/components/workspace/clients-page.tsx
- src/components/workspace/inquiries-page.tsx
- src/components/workspace/inquiry-actions.tsx
- src/features/auth/invitations.ts
- src/features/auth/service.ts
- src/features/auth/verification.ts
- src/features/content/service.ts
- src/features/inquiries/service.ts
- src/features/users/service.ts
- src/lib/api/handler.ts
- src/lib/auth/actor.ts
- src/lib/auth/rate-limit.ts
- src/lib/auth/redirect.ts
- src/lib/auth/session.ts
- src/lib/auth/token.ts
- src/lib/constants.ts
- src/lib/email/transactional.ts
- src/lib/migrations.ts
- src/lib/permissions/index.ts
- src/models/ContactRequest.ts
- src/models/User.ts
- src/proxy.ts
- tests/api.test.ts
- tests/auth-inquiries.test.ts
- tests/email-sender.test.ts
- tests/helpers.ts
- tests/inquiry-api.test.ts
- tests/opportunities.test.ts
- tests/outreach-auth.test.ts
- tests/outreach-email.test.ts
- tests/service-management.test.tsx
- tests/unit.test.ts
- tests/website-analytics.test.ts
- tests/workspaces.test.ts
