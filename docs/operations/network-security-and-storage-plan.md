# MongoDB network security and storage maintenance

**Current status: the subsequently authorized identity-only cleanup completed successfully.** See [the final cleanup report](./database-cleanup-result.md) for every collection's deletion/preservation count, backup verification, storage measurements and live-check results. This file records the security recommendations and execution scope; pending-execution language below is historical. The user accepted the local backup and withdrew the request for another backup destination.

## Confirmed incident resolution

MongoDB Network Access Restriction caused the production Login and Sync Today API failures. The operator's addition of `0.0.0.0/0` restored both workflows without code deployment or database cleanup. This is confirmed by the operator's production tests. Storage pressure and the separately fixed reconnect-cache defect are not the identified cause of that outage.

## Safest practical configuration within Hobby + M0

Keep the currently working Atlas network rule while hardening authentication and permissions. Public IPv4 reachability remains an exposure: any host can attempt a connection, but valid database credentials and validated TLS are still required. This is a practical cost-constrained configuration, not private networking.

Vercel Static IPs are available on Pro/Enterprise, with the published Pro add-on priced at $100/project/month plus data transfer and the underlying plan. They are not a Hobby feature. Do not substitute the website's DNS/ingress IP, one observed function IP, or a home IP for a stable outbound address. Pinning a function region is not an egress-IP guarantee. [Vercel Static IPs](https://vercel.com/docs/networking/static-ips)

Atlas M0 does not support private endpoints or network peering. Private endpoints require M10 or higher. A paid network upgrade or a separately operated stable-egress backend is a future option, not a required expense to keep the present app working. [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [Atlas private endpoints](https://www.mongodb.com/docs/atlas/security-private-endpoint/)

Read-only credential review at 11:43 UTC on 7 November 2026:

- The configured local credential authenticates with **atlasAdmin@admin**, broader than necessary for ordinary application use. This does not independently establish the roles of Vercel's unreadable sensitive credential.
- TLS is enabled. Certificate and hostname validation are enabled.
- The database password is below the audit's 32-character recommendation. Length alone does not prove weakness or reuse; randomness was not established. No password, username, URI or hash was printed.
- The local session secret meets the 32-character minimum. Its randomness was not established.
- Only `.env.example` is tracked among the checked env paths; `.env.local` and diagnostic backups are ignored. This is not a complete historical-secret scan.

Recommended next security change, subject to the user's approval: use a dedicated application database user with `readWrite` scoped to **ExploreTechify**, restricted to Cluster0, rather than atlasAdmin or any-database access. Test login, sync, background work and required index/migration operations with the narrower privileges first; keep administration and backup credentials separate. Do not grant broad admin privileges merely to bypass a failed migration. Atlas management accounts and database users are different identities. [Atlas database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)

If the same confirmed application username/password can remain, narrowing its Atlas roles usually requires no application environment change or redeploy; allow role propagation and verify new connections. Changing a username/password or Vercel secret requires a coordinated environment update and deployment for the app to receive it. Plan one controlled rotation if the credential is short, reused or exposed; no credential rotation or role change was performed here. Keep production credentials out of preview/dev deployments; earlier metadata showed the MongoDB variable scoped to both production and preview, which warrants review. Protect Atlas/Vercel management accounts with MFA and review unused management/database users separately. Management MFA does not replace database authentication. [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)

The working `0.0.0.0/0` rule remains unchanged. To replace it in the future, test a stable-egress alternative against a restrictive allowlist in an **isolated Atlas project** first: Atlas's list is project-wide, and leaving `0.0.0.0/0` alongside narrower rules does not test or enforce those narrower rules. After staging passes, obtain permission for the production switch, test cold/warm functions and all necessary execution regions, and keep a rollback to the known working rule. No replacement has been provisioned or claimed tested. [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/)

Check whether the current rule has an expiration date in Atlas so it does not silently expire before a tested replacement is ready. No expiration setting was inspected or changed through an Atlas management API in this review.

## Latest cleanup authorization

The user superseded the earlier external-backup request: preserve the verified local backup, stop pursuing another destination, and delete the identified non-user business data after integrity/target/dependency checks. The user separately confirmed that Vercel Production and `.env.local` use the same cluster and **ExploreTechify** database. No additional deletion approval is being requested for that authorized scope.

The accepted recovery point is `storage/backups/storage-audit/full-2026-11-07T11-43-11-802Z/bundle.json`. It covers 52 application collections and six sample collections. Compressed BSON read-back, document counts/fingerprints, indexes and options were verified, then the complete backup was reverified against both live databases before cleanup. Original backup files are read-only inputs and are not modified or deleted. They are compressed, not encrypted; keep them private and offline/protected as appropriate. Atlas settings, database-user credentials and Vercel secrets are outside the logical application backup and remain unchanged.

The following application collections are protected in full: **users, User, organizations, deletedidentities, authratelimits, systemsettings, clientdeletions, suppressionentries, auditlogs, counters, countries**. All password hashes, roles, grants, verification/reset/invitation fields, session versions, profile data and client memberships remain intact. The small country/provider configuration is retained because Sync Today's preparation requires it. No preserved organization references a company record that would be deleted. The six currently unverified accounts remain unverified; none are activated, recreated or reset.

The authorized business collections to empty are: **casestudies, checkpoints, clientdocuments, clientservices, companies, contactrequests, contacts, conversations, crmactivities, dailyregistrationsnapshots, emailcampaigns, emailmessages, emailtemplates, established_companies, followups, inboxitems, jobs, leadassignments, lookupcaches, messages, notifications, opportunities, opportunityevents, opportunityfeeds, opportunitysyncruns, projects, projecttasks, providerusages, quotations, registrysyncs, servicepackages, services, supporttickets, translations, webanalyticsdailies, webconversions, webeventkeys, webpageviews, websessions, websiteaudits, webvisitors**. This includes custom content/client history, explicitly authorized by the user's latest identity-only scope. The cleanup deletes only backed-up IDs; it retains application collection definitions and indexes.

The separately authorized unused **sample_mflix** database contains **embedded_movies (3,483), sessions (1), movies (21,349), users (185), comments (41,079), theaters (1,564)**. Its 185 sample identities are separate from the ten protected application users. Runtime authentication uses the explicit ExploreTechify connection and no runtime code references sample_mflix. Atlas database-user authentication is separate from these sample documents. `admin`, `local`, `config` and every other database remain untouched.

Before cleanup, the measured application+sample data/index total was **514,493,732 bytes (490.66 MiB)**. The sample database accounted for **150,099,226 bytes (143.15 MiB)**. There were 58,031 companies, 24,848 contacts, 3,941 established companies and 5,347 jobs. The approved snapshot contains **96,232 business records** plus **67,661 sample records**. Final execution counts and post-cleanup storage are recorded below when complete.

Safeguards tested in a disposable database: identity deletion refused, changed-source snapshots refused before deletion, corrupted recovery metadata refused, users/organizations/country settings preserved, business data cleared, indexes retained, and the separate sample database removed. Typechecking and scoped lint passed. Full application rebuild/deployment is unnecessary for database-only maintenance and was not performed in this task.

No network rule, Atlas user/role, database password, production environment variable or deployment was changed by this task. Only the explicitly authorized cleanup mutates production business data. Files stored outside MongoDB are outside this cleanup and are not deleted.
