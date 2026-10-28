# Website Analytics

Owner-only analytics for the public website, at **Dashboard → Website Analytics** (`/dashboard/website-analytics`). It answers marketing questions: how many people visited, how they got there, which pages and services they looked at, whether they came back, and whether they sent an enquiry.

It is **not** a tool for identifying people. Visitors stay anonymous unless they log in or send an enquiry themselves.

## Access

Only the **OWNER** role can see it. There is no separate "Super Admin" role in this application: the Owner is the highest role, and Owner-only modules are gated on the actual role, not on a permission that could be delegated.

| Layer | Check |
|---|---|
| Proxy (`src/proxy.ts`) | `/dashboard/website-analytics/*`: plain 404 for any signed-in non-owner |
| Pages | `requireOwnerPage()`: 404 for non-owners |
| APIs (`/api/website-analytics`, `…/visitors/[id]`, `…/export`) | `route({ ownerOnly: true })`: 401 if not signed in, 403 for ADMIN/STAFF/CLIENT |
| Service (`src/features/website-analytics/service.ts`) | every function checks `isOwner` again |
| Retention setting | `/api/admin/settings/analytics`: non-website settings are Owner-only |

The navigation item is shown only to the Owner.

## Consent

The public site opens a **centred consent dialog** (native modal `<dialog>`, with an overlay) with equally clear **Accept** and **Deny** buttons, in every site language. While no decision is saved, the page behind it is inert: it can't be scrolled, clicked or reached with the keyboard. Focus stays inside the dialog, and **Escape does not bypass the choice**. When the dialog is reopened from **Cookie settings** in the footer, Escape closes it and keeps the saved decision.

The decision is stored in the first-party `et_consent` cookie (13 months) with its **policy version, timestamp and categories** (`src/lib/consent.ts`):

```
et_consent = granted.2.1793174400.essential+analytics   |   denied.2.1793174400.essential
```

A decision counts only when it is for the current `CONSENT_VERSION`, is less than 13 months old, and its categories match the decision. Anything else (no cookie, the earlier bare `granted` / `denied` value, an expired or tampered value) means **no decision**: the dialog asks again and nothing optional runs. Bump `CONSENT_VERSION` when the cookie policy changes; everyone is asked again once. A valid decision is never prompted again.

| State | What is recorded |
|---|---|
| No valid decision yet | **Nothing.** The tracker sends no beacon, and `/api/track` refuses events anyway. Only essential cookies exist (sign-in, security, language, this decision). |
| **Deny** | **Nothing.** Anything recorded earlier for this browser is deleted (`/api/track/consent`) and `et_vid` is removed. |
| **Accept** | The server sets `et_vid`: an httpOnly, random, anonymous id (13 months). Page views are grouped into visitors and sessions. The page the visitor is on is recorded at that moment, with how the tab arrived (source, campaign). |

Until October 2026 the site counted page views without consent (no identifier). Those historical records are kept and still shown as "visits without consent"; new ones are no longer recorded.

## What is collected

**Never stored:** IP addresses (used only in memory for the location lookup, see below), browser fingerprints, full referrer URLs (query strings are dropped), form contents, or anything about who a visitor is.

- **Visitor** (consent only): HMAC-SHA256 hash of the cookie id (the raw value is never stored; key `ANALYTICS_SECRET`, default `AUTH_SECRET`), a 4-character display code ("#A82F"), first/last seen, session and page-view counts, first source/campaign/landing page, and the links below.
- **Session** (consent only): start, last activity, page count, landing and exit page, channel, referring domain, referrer (origin + path), UTM tags, enquiries.
- **Page view**: time, path, language-neutral page, language, Service Management slug for `/services/<slug>`, consent flag, visitor/session (consent only), source for arrivals, coarse location and the browser's time zone.
- **Visitor and session** also keep the coarse location and time zone, so the dashboard shows where and when each visit happened.

### Linking a visitor to a person

This happens only through the visitor's own first-party actions, and only on a browser that accepted analytics:

- **Contact form submitted:** the enquiry is linked to the visitor, and its earlier visits show in the visitor's timeline. The visitor's status becomes **Lead**.
- **Client login:** the client account is linked. Status becomes **Authenticated**.

Nothing is inferred from technical signals.

The Owner, Admin and Staff accounts are **never tracked**, so the team's own browsing doesn't inflate the numbers.

## Location and visit time

Each recorded page view gets a **coarse location**: country, region and city. Sources, in order:

1. Location headers from the hosting platform, when present (Vercel `x-vercel-ip-*`, Cloudflare `cf-ipcountry` / `cf-ipcity` / `cf-region`).
2. Otherwise a **local, offline** GeoIP database on this server: DB-IP "IP to City Lite" (`.mmdb`).
   - Download or refresh it with `npm run geoip:update`. DB-IP publishes a new file monthly, so schedule the command monthly.
   - It is saved to `.data/geoip/dbip-city-lite.mmdb` (ignored by git), or to the path in `GEOIP_DB_PATH`.
   - Restart the app after an update.

How the IP address is handled:

- It is used **only in memory** for that one lookup, then discarded.
- It is never stored, logged or sent to a third-party service.
- Private and local addresses get no location.
- Without a database or headers, the location shows as *Unknown*; everything else keeps working.

City-level IP location is approximate; it often shows the internet provider's location, not the visitor's.

**Visit time**: every time is shown in Norwegian time (Europe/Oslo). The tracker also sends the browser's time zone (for example `America/New_York`). When it differs, the dashboard adds the visitor's own local time.

Where it shows:

- **Overview → Recent visits**: when, from where, how they arrived, landing page.
- **Locations tab**: countries and areas.
- **Location** column in the visitors table.
- Location and local time for every visit on a visitor's timeline.
- Country, region, city and time zone columns in the CSV exports, plus a **Locations** export.

Attribution: IP geolocation by [DB-IP](https://db-ip.com), licensed under CC BY 4.0. The attribution is shown on the analytics page.

## Definitions

- **Unique visitor:** one browser that accepted analytics.
- **Session (visit):** consecutive page views from one visitor. **A session ends after 30 minutes without activity** (`SESSION_TIMEOUT_MS`). A new UTM campaign arriving mid-visit also starts a new session, so each campaign gets its own credit. When the tab is hidden, the tracker sends a ping, so the session's end time (and duration) is accurate without adding a page view.
- **Returning visitor:** a visitor with a session in the period that was not their first.
- **Visitors (headline card):** all visits, meaning tracked sessions plus arrivals without consent.
- **Enquiries:** contact-form submissions in the period (all of them). "Linked" counts those sent from a tracked visit.
- **Conversion:**
  - Sources and campaigns: tracked sessions that sent an enquiry ÷ tracked sessions.
  - Service pages: enquiries sent from the service's page ÷ visits that viewed it.

All days are Norwegian time (Europe/Oslo).

### Channels

UTM tags first, then the referring domain:

| Channel | Rule |
|---|---|
| Email | `utm_medium` email/outreach/newsletter, `utm_source` email; or referred from webmail (mail.google.com, Outlook…) |
| Google | Google search |
| LinkedIn | LinkedIn |
| Facebook | Facebook |
| Instagram | Instagram |
| Other search | Other search engines |
| Other social | Other social networks |
| Other campaign | Any other UTM-tagged link |
| Other referral | Any other website |
| Direct / unknown | No referrer |

### Email → website

The Email Sender adds `utm_source=email&utm_medium=outreach&utm_campaign=outreach-<template>` to the email's button link (`outreach-custom` for custom emails). Only links to our own domain are tagged, and existing tags are never overwritten. The tags identify the campaign, never the recipient. Email opens are not tracked.

To tag links you share elsewhere, add UTM parameters yourself. For example:

```
https://exploretechify.com/services/seo?utm_source=linkedin&utm_medium=social&utm_campaign=autumn-post
```

## Bot filtering

Requests are not recorded when:

- the user agent matches a conservative list of crawlers, link-preview fetchers, uptime monitors, headless browsers and HTTP libraries (`isBot` in `classify.ts`);
- the user agent is missing or very short;
- `navigator.webdriver` is true (automated browsers).

The tracker also only runs from JavaScript in the page, which most crawlers never execute. Detection is deliberately not aggressive: an unusual but real browser is still counted.

## Retention and history

- **Raw records** (visitors, sessions, page views, lead attribution records) carry an `expireAt` date. A MongoDB TTL index removes them after the retention period set on the analytics page: 3, 6, 13 (default) or 25 months. A change applies to activity recorded from then on.
- **Daily statistics** (`WebAnalyticsDaily`, one row per Norwegian calendar day) are **kept permanently**. They are anonymous aggregates: unique visitors, sessions, page views, leads by type, converted sessions, and sources, devices, countries and top pages with counts.
  - The scheduler rolls up today and yesterday on every tick (every 5 minutes). Opening the History or Leads tab refreshes them too.
  - From the day before yesterday on, a day is **final**. It is computed once more and then frozen. Raw expiry can never lower or rewrite a historical number.
  - Nothing is estimated. A day is computed only from records that exist. A day whose raw records may already have been expiring before its first roll-up is marked **partial** (shown with \*).
- **Leads** (`WebConversion`) and the attribution copied onto an enquiry are part of the lead record.
- **Beacon keys** (`WebEventKey`) de-duplicate retried requests and expire after 7 days.

### Why traffic seemed to disappear

The code keeps raw records for 13 months by default (never less than 30 days), and nothing deletes them in bulk except a visitor's own Deny. Before October 2026, though, every number was computed live from raw records. Nothing durable kept the history, so anything that removed or hid raw data made past traffic vanish.

`npm run analytics:diagnose` is a **read-only** check of the live database. It lists the TTL indexes MongoDB actually has, the retention setting, how far back raw records reach, records per day, and whether `MONGODB_URI` is set. Things to look for:

- A TTL index with `expireAfterSeconds` > 0 on a time field. An older build or a manual change may have created one, and MongoDB keeps an index even after the code changes.
- `expireAt` only a day or two after the visit.
- A server running without `MONGODB_URI`, so data sits on a disk that a redeploy wipes.

The daily statistics make history independent of all three.

### Backups

`npm run analytics:backup` writes the daily statistics and lead records (add `--raw` for raw visits) as NDJSON. Output goes to `storage/backups/analytics/<timestamp>/`, or to `--out <dir>`. It is read-only on the database and contains no IP addresses. Schedule it daily (cron / Task Scheduler) and copy the folder off the server. It complements, and doesn't replace, the database's own backups (e.g. Atlas snapshots).

## Performance and failure handling

- The tracker sends small `fetch(…, { keepalive: true })` beacons after the page has rendered. Pages never wait for analytics.
- `/api/track` always answers 200, whether the event was recorded, ignored (bot, invalid) or failed (logged). It is rate-limited per IP (240/min) and rejects cross-site requests.
- Linking an enquiry or a login is wrapped so that a failure can never fail the contact form or the sign-in.
- Queries are aggregations over indexed fields (`startedAt`, `at`, `visitorId`, `sessionId`).

## History, leads and attribution

- **History tab**: daily, weekly (Monday–Sunday) or monthly periods for any preset or custom range, compared with the previous period of the same length. It shows source attribution, devices and top pages, with pagination. All days are Europe/Oslo.
  - **Unique visitors** for a single day is exact. For a week, month or range it is exact while raw sessions still cover the whole period.
  - Older periods show the **sum of daily unique visitors**, labelled "sum of days".
  - A repeated page load is never a new visitor.
- **Leads tab**: every lead submission, with type, contact and attribution.
  - **Types**: contact-form enquiry, **consultation request** (an enquiry asking for a phone or video call — the site has no calendar booking) and client sign-up.
  - **Contact details** are shown only as the person entered them in the form or at sign-up. Nothing is looked up or inferred.
  - **Attribution**: for a browser that accepted analytics, the lead keeps its **first touch** (first recorded visit: channel, referrer, UTM, landing page) and **last touch** (the visit that converted), also stored on the enquiry. Other leads are counted but shown as **Anonymous**.
- **Definitions**:
  - Leads: all lead submissions, consented or not.
  - Conversion rate: tracked sessions that produced a lead ÷ tracked sessions.
  - Ingestion is idempotent. Each beacon carries a random event id, so a retry is counted once, and each lead has one record per enquiry or sign-up.

## CSV export

Exports for the selected period:

- **Visitors**, **sessions**, **page views**, **sources**, **campaigns** and **locations**.
- **Daily statistics** and **leads** (attribution only).

They contain no IP addresses, names, email addresses or phone numbers. Visitors appear only by display code. Cells are protected against spreadsheet formula injection.

## Code

| Path | What |
|---|---|
| `src/features/website-analytics/classify.ts` | Pure rules: bots, channels, UTM, paths, hashing, campaign links |
| `src/features/website-analytics/geo.ts` | Coarse location (hosting headers or local GeoIP database) and time-zone validation |
| `scripts/geoip-update.mjs` | Downloads the DB-IP City Lite database |
| `src/features/website-analytics/collect.ts` | Recording, enquiry/login linking, forgetting a visitor |
| `src/features/website-analytics/service.ts` | Owner-only queries and CSV export |
| `src/models/WebAnalytics.ts` | `WebVisitor`, `WebSession`, `WebPageView` |
| `src/lib/consent.ts` | Consent record: version, timestamp, categories, validity |
| `src/components/site/site-analytics.tsx` | Consent dialog and beacon |
| `src/features/website-analytics/rollup.ts` | Durable daily statistics (roll-up, freeze, backfill) |
| `src/features/website-analytics/history.ts` | History, leads and their CSV exports (Owner only) |
| `scripts/analytics-diagnose.ts`, `scripts/analytics-backup.ts` | Read-only health check; NDJSON backup |
| `src/app/api/track/*` | Public beacon and consent withdrawal |
| `src/app/api/website-analytics/*` | Owner-only statistics, visitor detail, CSV |
| `tests/website-analytics.test.ts`, `tests/analytics-history.test.ts`, `tests/consent.test.tsx` | Tests |
