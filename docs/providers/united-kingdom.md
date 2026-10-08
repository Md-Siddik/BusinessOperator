# 🇬🇧 United Kingdom: Companies House Public Data API

| | |
|---|---|
| Provider id | `companies-house` (`src/features/registry/providers/companies-house.ts`) |
| Official source | Companies House |
| API documentation | https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference |
| Authentication | Free API key, sent as HTTP Basic auth (key as username, empty password) |
| Data freshness | **Current registry data**, served live by the API. This provider does **not** use the periodic bulk snapshots. |
| Scheduled sync | Every 60 minutes (default) |
| Official record link | `https://find-and-update.company-information.service.gov.uk/company/{number}` |

## Endpoints used

- Daily list: `GET /advanced-search/companies?incorporated_from=D&incorporated_to=D&size=5000&start_index=N`
- Single company: `GET /company/{number}`
- Officers: `GET /company/{number}/officers` (active officers only; the first director becomes the contact person)

## Fields mapped

Company number, name, incorporation date (used as the registration date), status, company type (legal form), SIC 2007 codes (the first four digits map to the NACE class), and registered office address.

## What it does not provide

Companies House publishes **no email addresses, phone numbers or websites**. Those fields show "Not published by this registry"; use **Find contact details** on a company once a website is known.

## Rate limits

600 requests per 5 minutes per key. The client spaces requests by at least 550 ms. Officers are fetched only for the most recent registrations (`REGISTRY_PEOPLE_PER_RUN`), and for others when the profile is opened.

## Setup

1. Create an account at https://developer.company-information.service.gov.uk/ and register an application.
2. Create a **REST API key** for the live environment.
3. Add `UK_COMPANIES_HOUSE_API_KEY=<key>` to `.env.local` (or your server environment).
4. Restart the application. The United Kingdom changes to *Connected* and the scheduler runs the first sync.
5. Verify with `npm run registry:verify -- GB`.

## Streaming worker (new incorporations as they are published)

| | |
|---|---|
| Endpoint | `GET https://stream.companieshouse.gov.uk/companies?timepoint=N` (Basic auth: `<streaming key>:`) |
| Docs | https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview |
| Key | A **separate Streaming application**. REST and stream keys are not interchangeable. Variable: `UK_COMPANIES_HOUSE_STREAMING_API_KEY`. |
| Worker | `src/features/registry/companies-house-stream.ts`. One persistent server-side connection, never one per browser session. |
| Resume | The last committed `timepoint` is stored in the `checkpoints` collection only **after** events are stored. Replays are idempotent. |
| Gap recovery | HTTP 416 (timepoint too old) triggers an incremental REST advanced-search sync, then resumes live. |
| Throttling | HTTP 429 waits at least 1 minute (documented). A maximum of 2 concurrent connections per account. |
| Watchdog | No data or heartbeat for 2 minutes triggers a reconnect. Blank lines are heartbeats. |
| New vs changed | A `company-profile` event is new only if `data.date_of_creation` falls within the last 3 days. Otherwise it is a change and re-queues contact research. |
| Status | **Documented.** Event handling is tested with recorded event shapes; it is not yet connected to the live stream (needs the key). |
