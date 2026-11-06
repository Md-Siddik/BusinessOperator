# Personal marketer assignments

The existing Company collection remains the source of client data. LeadAssignment stores company/user references, destination, status, attribution and compact history. Shared delivery remains separate from personal delivery. No per-user collections, Blob storage or dependencies are added.

The Owner sends single or bulk selections to the shared table or an active marketer/admin who has the existing View Marketer Table permission. The Client leads destination filter provides Assigned to Me. Other users cannot read personal records; the Owner and admins with Manage Marketer Table can monitor, filter and reassign them in the existing management view. Ordinary admins may change outreach only on their own personal records; shared records remain read only for them.

One active personal handler is allowed per company. Repeated delivery is idempotent. Shared rows show a personal handler and their outreach status, and refuse competing outreach updates. Status and its history entry are saved together using a conditional update; stale concurrent changes return a conflict. Unchanged statuses generate no history or audit write. Admin edits also reject stale changes.

## Deployment

Run `npm run migrate` using the existing deployment migration process before enabling assignment traffic. The new `2026-11-personal-handler-unique-v1` step creates the unique partial index on companyId for active individual assignments. It stops if existing data contains multiple active personal handlers; review these in the management table and withdraw extra assignments, then rerun. It never deletes or merges client data. The existing company/recipient unique index continues to prevent duplicate retries. Do not disable or remove these indexes.

No production migration or production data update was performed during implementation. Existing historical outreach entries remain unchanged; new status changes use atomic history writes.
