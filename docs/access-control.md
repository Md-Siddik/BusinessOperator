# Access control

_Updated 27 Oct 2026. Source of truth: [`src/lib/permissions/catalog.ts`](../src/lib/permissions/catalog.ts) (catalog), [`src/lib/permissions/index.ts`](../src/lib/permissions/index.ts) (policy), [`src/features/access/service.ts`](../src/features/access/service.ts) (grants)._

## Principles

1. **Default deny.** Everyone except the Owner holds only what has been explicitly granted to them.
2. **Roles are identities, not access.** A role decides which permissions *can* be granted (eligibility) and which workspace someone signs in to. It never grants a permission by itself.
3. **Server-side everywhere.** Pages (`requireTeamPage`, `requireStaffPage`, `requireInternalPage`, `requireOwnerPage`), API routes (`route({ team, permission, anyPermission, internal, ownerOnly })`) and services check the same permission. Navigation is built from the same rules, but hiding a link is never the only check.
4. **No stale access.** The actor is rebuilt from the database on every request, so a grant or revocation applies to the next click or API call. No sign-out is needed (role changes and suspensions still sign the person out everywhere).
5. **Company Intelligence is Owner-only.** No role, permission, payload or database edit can give it to anyone else.

## Workspaces

| Role | Signs in to | Notes |
|---|---|---|
| Owner | `/dashboard` | Everything, by role. |
| Super Admin (`ADMIN`) | `/staff` | Only granted permissions. May hold scoped delegation permissions. |
| Staff | `/staff` | Only granted permissions. |
| Digital Marketer | `/staff` (shown as “Marketing workspace”) | Starts with nothing. Never a client-service user (`isInternal` is false), so client data stays closed unless the catalog makes it eligible. |
| Client | `/portal` | Unchanged. |

## Permission catalog

“Eligible” = roles the permission may be granted to. “Delegated by” = the one scoped permission that lets a Super Admin grant it (besides the Owner).

| Key | Label | Group | Eligible | Delegated by |
|---|---|---|---|---|
| `marketerLeads.view` | View Assigned Client Leads | Marketing | Digital Marketer | `marketerLeads.grant` |
| `marketerLeads.grant` | Manage Marketer Lead Access | Marketing | Super Admin | Owner only |
| `leads.sendToMarketer` | Send Leads to Marketers | Company Intelligence | **Owner only** | — |
| `opportunities.view` | View Opportunity Intelligence (read only) | Opportunity Intelligence | Super Admin, Staff, Digital Marketer | `opportunities.grant` (grantor must also hold `opportunities.view`) |
| `opportunities.grant` | Grant Opportunity Intelligence Access | Opportunity Intelligence | Super Admin | Owner only |
| `opportunities.manage` | Manage Opportunity Intelligence (verify, save, notes, export, sources) | Opportunity Intelligence | **Owner only** | — |
| `clients.manage` | Manage Clients & Inquiries | Clients | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `chat.manage` | View All Client Conversations | Clients | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `conversations.assigned` | Answer Assigned Conversations | Clients | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `tickets.manage` | Manage All Requests & Tickets | Requests & projects | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `tickets.assigned` | Work on Assigned Tickets | Requests & projects | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `projects.manage` | Manage All Projects | Requests & projects | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `projects.assigned` | Work on Assigned Projects | Requests & projects | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `content.manage` | Edit Website Content | Website | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `services.manage` | Manage Services & Prices | Website | Super Admin, Staff | `users.manage` → Staff, grantor must hold it |
| `users.manage` | Manage Staff Accounts | Team | Super Admin | Owner only |
| `analytics.view` | View Team Reports | Team | Super Admin, Staff | Owner only |
| `companies.read` | View Company Intelligence | Company Intelligence | **Owner only** | — |
| `companies.edit` | Edit Company Records | Company Intelligence | **Owner only** | — |
| `companies.export` | Export Company Data | Company Intelligence | **Owner only** | — |
| `registry.sync` | Run Registry Syncs | Company Intelligence | **Owner only** | — |
| `leads.manage` | Manage CRM Leads | Company Intelligence | **Owner only** | — |
| `outreach.manage` | Create Outreach | Company Intelligence | **Owner only** | — |
| `outreach.approve` | Approve & Send Outreach | Company Intelligence | **Owner only** | — |
| `websiteAnalytics.view` | View Website Analytics | Owner tools | **Owner only** | — |
| `emailSender.use` | Use the Email Sender | Owner tools | **Owner only** | — |
| `mailbox.view` | Read Client Mail | Owner tools | **Owner only** | — |
| `settings.manage` | Manage System Settings | Owner tools | **Owner only** | — |
| `audit.view` | View Audit Logs | Owner tools | **Owner only** | — |

Every `/staff` navigation entry is declared in [`src/lib/permissions/navigation.ts`](../src/lib/permissions/navigation.ts) with the permissions that unlock it; a test fails if a new `/staff` or `/dashboard` section is added without a catalog entry.

## Who may do what (summary)

| | Owner | Super Admin | Staff | Digital Marketer |
|---|---|---|---|---|
| Company Intelligence (Today, countries, research, CRM, outreach, exports) | ✅ | ❌ never | ❌ never | ❌ never |
| Send leads to marketers | ✅ | ❌ | ❌ | ❌ |
| Client leads table (own assigned leads) | — | ❌ | ❌ | Only with `marketerLeads.view` |
| Opportunity Intelligence (read) | ✅ | With `opportunities.view` | With `opportunities.view` | With `opportunities.view` |
| Opportunity Intelligence (manage / export) | ✅ | ❌ | ❌ | ❌ |
| Grant Opportunity Intelligence to others | ✅ | Only with `opportunities.view` **and** `opportunities.grant`; OI view only | ❌ | ❌ |
| Grant client-leads access to marketers | ✅ | Only with `marketerLeads.grant`; marketers only | ❌ | ❌ |
| Create Staff / pass on staff permissions | ✅ | Only with `users.manage`; Staff only; permissions they hold | ❌ | ❌ |
| Create Super Admins / Digital Marketers, change roles | ✅ | ❌ | ❌ | ❌ |
| Change own access | — | ❌ | ❌ | ❌ |

## Grants and provenance

Grants are stored on the account (`User.permissionGrants`): `{ permission, grantedBy, grantedByRole, origin: OWNER | DELEGATED | MIGRATION, via, grantedAt }`. A permission is held while at least one grant exists and the role is eligible. `User.permissions` mirrors the union in the same atomic update. Grant and revoke are single-document pipeline updates, idempotent (a retry never stores a second grant from the same person); a delegated grant is re-checked after the write, so an authority removed mid-request rolls it back.

**Revocation rules**

- The Owner removes every grant of a permission.
- A delegate removes only non-Owner grants; Owner grants can only be removed by the Owner.
- **Cascade (Opportunity Intelligence, marketer leads):** grants issued *through* `opportunities.grant` or `marketerLeads.grant` depend on the grantor still holding that authority (and, for OI, `opportunities.view`). When the grantor loses either, those grants are removed — recursively — and each removal is audited with reason `CASCADE_GRANTOR_LOST_AUTHORITY`. A person who also holds an independent Owner grant keeps the permission.
- Staff permissions passed on through `users.manage` are administrative changes and are **not** cascaded.
- A role change never adds permissions; grants the new role can't hold are removed and audited (`ROLE_CHANGED`).

## Audit trail

| Action | When |
|---|---|
| `permission.granted` | Every grant (metadata: permission, target role, origin, via, `initial` for account creation) |
| `permission.revoked` | Every revocation (metadata: removed grants with origin / grantor; `reason` for cascades and role changes) |
| `user.created`, `user.role_changed`, `user.suspended`, `user.reactivated`, `user.sessions_revoked` | Account changes |
| `lead.sent_to_marketer`, `lead.resent_to_marketer`, `lead.withdrawn_from_marketer` | Lead handoffs (also logged on the company's CRM timeline) |

## Adding employees directly

The Owner and a Super Admin with “Manage Staff Accounts” add employees from **Users & access → Add employee** (`POST /api/admin/users`; lookup: `GET /api/admin/users/lookup?email=`). There is no invitation or approval step: the account is `ACTIVE` at once, appears in the list immediately, gets the role's suggested starting access (as recorded grants) and stores `addedBy` / `addedAt` (also audited). The employee confirms their email address with a one-time code the first time they sign in — a security check, not an approval.

- **New email** → new account with the initial password the adder types (nothing is generated or shown back).
- **Team account that was invited but never activated** → activated as-is: name, password, role and access are not changed; the pending invitation is invalidated. Without a password, the employee uses “Forgot password”.
- **Active team member** → refused as a duplicate. **Suspended** → refused (reactivate instead). **Client account** → refused: one account has one role, and the client membership is never touched.
- A Super Admin can add Staff only; Super Admins and Digital Marketers are added by the Owner.

## Lead handoff (Owner → Digital Marketer)

- **Send to Marketer** in the Lead column of Today's New Companies (desktop and mobile). One marketer per send, consistent with the single-owner lead model; a lead can be sent to further marketers separately, and withdrawn.
- Stored in `LeadAssignment` (unique per company + recipient, with sender, timestamps, status and history). The Company record stays the source of truth.
- Sending does **not** grant access. A marketer without `marketerLeads.view` sees no menu entry, gets `403` from `/api/marketer/leads` and receives no notification (the notice itself would reveal the lead). Once granted, they see only their own active assignments: company name, contact person, phone, website (http/https only).

## Migration

`2026-10-access-grants-v1` (runs with the other migrations, `npm run migrate`, and automatically from the scheduler):

- Every Super Admin / Staff account keeps exactly its current access, written down as `MIGRATION` grants: its stored list (or role defaults when the list was empty) plus access to work assigned to it — previously implicit, now the named `*.assigned` permissions. Nothing is added.
- Until an account is migrated it keeps its previous access; new scoped permissions (Opportunity Intelligence, marketer leads) are only ever effective through a recorded grant.
- Creates the `LeadAssignment` indexes and an index on `permissionGrants.grantedBy`.

## Assumptions

- The Owner sends leads one marketer at a time (the existing CRM has a single lead owner); multiple marketers are supported by sending again.
- Delegated Opportunity Intelligence is read-only and never includes the Owner's notes, saves, review states, exports or links into Company Intelligence.
- Accounts bootstrapped from `src/features/auth/invitations.ts` keep the previous role-default behaviour until their first permission change.
