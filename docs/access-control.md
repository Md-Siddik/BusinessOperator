# Access control

_Updated 28 Oct 2026. Source of truth: [`src/lib/permissions/catalog.ts`](../src/lib/permissions/catalog.ts) (catalog), [`src/lib/permissions/index.ts`](../src/lib/permissions/index.ts) (policy), [`src/features/access/service.ts`](../src/features/access/service.ts) (grants, presets, role templates)._

## Principles

1. **Default deny.** Everyone except the Owner holds only what has been explicitly granted to them.
2. **Roles are identities, not access.** A role decides which permissions *can* be granted (eligibility), which workspace someone signs in to, and which role template a new account starts from. It never grants a permission by itself.
3. **Server-side everywhere.** Pages (`requireTeamPage`, `requireStaffPage`, `requireInternalPage`, `requireOwnerPage`), API routes (`route({ team, permission, anyPermission, internal, ownerOnly })`) and services check the same permission. Navigation is built from the same rules, but hiding a link is never the only check.
4. **No stale access.** The actor is rebuilt from the database on every request, so a grant or revocation applies to the next click or API call. No sign-out is needed (role changes and suspensions still sign the person out everywhere).
5. **Owner tools stay with the Owner.** The Owner workspace (`/dashboard`), CRM pipeline, outreach, registry syncs, lead handoff, Owner mailbox, Email Sender, website analytics, system settings and audit logs can't be granted to anyone. **Company Intelligence data** (view, edit, export, delete) **is grantable per person** and is used from the team workspace (`/staff/companies`, `/api/company-intel`).
6. **Clients are isolated.** Clients use `/portal` and see only their own organization's data. No team permission is eligible for the Client role.

## Roles and workspaces

| Role | Signs in to | Notes |
|---|---|---|
| Owner | `/dashboard` | Everything, by role. Final administrative authority. |
| Admin (`ADMIN`, previously labelled “Super Admin”) | `/staff` | Only granted permissions. May hold scoped delegation permissions (staff accounts, Opportunity / Company Intelligence view, marketer leads). |
| Manager (`MANAGER`, new) | `/staff` | Only granted permissions. Eligible for client-service work, team reports and Company / Opportunity Intelligence. Managed by the Owner. |
| Staff | `/staff` | Only granted permissions. |
| Digital Marketer | `/staff` | Starts with nothing. Eligible for client leads, Company Intelligence (view / edit / export) and Opportunity Intelligence. Never a client-service user (`isInternal` is false). |
| Client | `/portal` | Unchanged. |

## Services and permissions

Permission Management shows one card per **service** with an **Access** switch (on = the service's View permission; off = every permission of the service is removed in one request) and **action chips** (View, Edit, Export, Delete, Manage…). “Advanced permissions” lists every permission with its description, who granted it and why a control is locked.

| Service | Key | Action | Eligible | Delegated by |
|---|---|---|---|---|
| Company Intelligence | `companies.read` | View | Admin, Manager, Staff, Digital Marketer | `companies.grant` (grantor must hold `companies.read`) |
| | `companies.edit` | Edit (Company Type override, contact refresh) | Admin, Manager, Digital Marketer | Owner only |
| | `companies.export` | Export | Admin, Manager, Digital Marketer | Owner only |
| | `companies.delete` | Delete | Admin | Owner only |
| | `companies.grant` | Grant access | Admin | Owner only |
| | `registry.sync`, `leads.manage`, `leads.sendToMarketer`, `outreach.manage`, `outreach.approve` | — | **Owner only** | — |
| Digital Marketer | `marketerLeads.view` | View | Digital Marketer | `marketerLeads.grant` |
| | `marketerLeads.grant` | Grant access | Admin | Owner only |
| Opportunity Intelligence | `opportunities.view` | View | Admin, Manager, Staff, Digital Marketer | `opportunities.grant` (grantor must hold view) |
| | `opportunities.grant` | Grant access | Admin | Owner only |
| | `opportunities.manage` | Manage | **Owner only** | — |
| Clients & conversations | `clients.manage`, `chat.manage`, `conversations.assigned` | Manage / View | Admin, Manager, Staff | `users.manage` → Staff, grantor must hold it |
| Requests & projects | `tickets.manage`, `tickets.assigned`, `projects.manage`, `projects.assigned` | Manage / Edit | Admin, Manager, Staff | `users.manage` → Staff, grantor must hold it |
| Website | `content.manage`, `services.manage` | Edit / Manage | Admin, Manager, Staff | `users.manage` → Staff, grantor must hold it |
| Team Management | `users.manage` | Manage | Admin | Owner only |
| | `analytics.view` | View | Admin, Manager, Staff | Owner only |
| Owner tools | `websiteAnalytics.view`, `emailSender.use`, `mailbox.view`, `settings.manage`, `audit.view` | — | **Owner only** | — |

Every `/staff` navigation entry is declared in [`src/lib/permissions/navigation.ts`](../src/lib/permissions/navigation.ts) with the permissions that unlock it; a test fails if a new `/staff` or `/dashboard` section is added without a catalog entry.

## Templates

- **Role templates** (Owner only, *Users & access → Role templates*): the starting access of new accounts per role (Admin, Manager, Staff, Digital Marketer). Stored in the `access.roleTemplates` setting; built-in defaults in `ROLE_TEMPLATES`. Saving can optionally **apply the template to every account with that role** — each change is an individual, audited grant or revocation.
- **Access presets** (`ACCESS_PRESETS`): named sets such as “Marketer — research & outreach lists”, “Manager — team workflows”, “Assigned work only”, “No access”. *Apply a template* on a person shows the exact additions and removals first; only changes the person applying it is allowed to make are sent.
- **Individual overrides**: after a template, any permission can still be switched per person; the summary says whether the person matches the role template or is customised.

## Who may do what (summary)

| | Owner | Admin | Manager | Staff | Digital Marketer | Client |
|---|---|---|---|---|---|---|
| Owner workspace: CRM, outreach, registry syncs, Owner tools | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Company Intelligence directory (view) | ✅ | if granted | if granted | if granted | if granted | ❌ never |
| Company Intelligence edit / export | ✅ | if granted | if granted | ❌ | if granted | ❌ |
| Company Intelligence delete | ✅ | if granted | ❌ | ❌ | ❌ | ❌ |
| Client leads table (own assigned leads) | — | ❌ | ❌ | ❌ | with `marketerLeads.view` | ❌ |
| Client-service areas | ✅ | if granted | if granted | if granted | ❌ | own organization only |
| Grant Company / Opportunity Intelligence view to others | ✅ | with view **and** the scoped grant permission | ❌ | ❌ | ❌ | ❌ |
| Create Staff / pass on staff permissions | ✅ | with `users.manage`; Staff only; permissions they hold | ❌ | ❌ | ❌ | ❌ |
| Create Admins / Managers / Digital Marketers, change roles, role templates | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Change own access | — | ❌ | ❌ | ❌ | ❌ | ❌ |

## Grants and provenance

Grants are stored on the account (`User.permissionGrants`): `{ permission, grantedBy, grantedByRole, origin: OWNER | DELEGATED | MIGRATION, via, grantedAt }`. A permission is held while at least one grant exists and the role is eligible. `User.permissions` mirrors the union in the same atomic update. Grant and revoke are single-document pipeline updates, idempotent; a delegated grant is re-checked after the write, so an authority removed mid-request rolls it back. Bulk changes (service switch, templates) are processed one permission at a time with the same checks; refused changes are reported, never silently skipped.

**Revocation rules**

- The Owner removes every grant of a permission.
- A delegate removes only non-Owner grants; Owner grants can only be removed by the Owner.
- **Cascade (Opportunity / Company Intelligence view, marketer leads):** grants issued *through* `opportunities.grant`, `companies.grant` or `marketerLeads.grant` depend on the grantor still holding that authority (and the view permission it delegates). When the grantor loses either, those grants are removed — recursively — and audited with reason `CASCADE_GRANTOR_LOST_AUTHORITY`. A person who also holds an independent Owner grant keeps the permission.
- A role change never adds permissions; grants the new role can't hold are removed and audited (`ROLE_CHANGED`).

## Audit trail

| Action | When |
|---|---|
| `permission.granted` / `permission.revoked` | Every grant / revocation (metadata: permission, target role, origin, via; `reason` for cascades and role changes) |
| `permission.template_applied` | A preset or role template applied to a person |
| `permission.role_template_changed` | The Owner changed a role template |
| `company.type_changed`, `company.contact_refresh_requested`, `company.deleted`, `companies.exported` | Company Intelligence actions from the team workspace |
| `user.created`, `user.role_changed`, `user.suspended`, `user.reactivated`, `user.sessions_revoked` | Account changes |
| `lead.sent_to_marketer`, `lead.resent_to_marketer`, `lead.withdrawn_from_marketer` | Lead handoffs |

## Adding employees directly

The Owner and an Admin with “Manage Staff Accounts” add employees from **Users & access → Add employee**. The account is `ACTIVE` at once and gets its role template as recorded grants (editable in the form). An Admin can add Staff only; Admins, Managers and Digital Marketers are added by the Owner. The employee confirms their email address with a one-time code the first time they sign in.

## Lead handoff (Owner → Digital Marketer)

Unchanged: the Owner sends a company from Today's New Companies; sending never grants access; the marketer needs `marketerLeads.view` and sees only their own active assignments — now with the shared **Company Type** tag (filterable and sortable).

## Migrations

- `2026-10-access-grants-v1` — existing Admin / Staff access recorded as `MIGRATION` grants (unchanged).
- `2026-10-company-type-v1` — classifies every company (adds `companyType`, tags `discoveredVia`); nothing else changes.
- `2026-10-manager-role-v1` — Manager accounts start with empty recorded grants.
