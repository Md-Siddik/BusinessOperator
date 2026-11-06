# Deleted-account return login

The password login system formerly hard-deleted its only password hash with the User document. No external identity provider exists from which to recover those credentials.

Deletion now retains a minimal DeletedIdentity credential record: normalized email, name, password hash (excluded from normal queries), email verification timestamp, security-block flag, old ID, reserved new ID and deletion timestamp. It retains no role, organization, grants or memberships. The User document is still removed and existing assignment cleanup and audit retention remain in place.

A valid password can recreate an unblocked deleted identity as an ACTIVE Staff account with empty recorded grants and a fresh ID. Email verification still follows the existing login policy. Atomic email upsert and the unique email index handle concurrent login attempts. Old JWT subjects reference the deleted ID, so they cannot access the new account, even with old role claims. Existing suspension checks remain in place; deleting a suspended account leaves a blocked credential record, and self-signup cannot bypass that block. An authorized administrator must explicitly create an account to restore access to a blocked deleted identity.

Run `npm run migrate` before deployment. Migration `2026-11-deleted-identity-v1` creates the unique index without changing existing users. No additional environment variables are required. Treat DeletedIdentity as authentication data in database access controls, backups and retention policies.

Passwords hard-deleted before this deployment cannot be recovered. An administrator must create a fresh Staff account with a new initial password for those users. Audit records cannot recover a password hash. This change never guesses credentials or restores privileges from historical audit data.

The existing company directory has permission-based access, with no country-restricted account field. Do not grant broad company-directory access when a worker should see only selected SG/MY work. Use individual marketer assignments and the existing table permission; shared table records remain visible under the existing shared-table policy. This does not introduce a general country-level RBAC system.
