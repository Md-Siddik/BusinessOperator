# 🇸🇪 Sweden: SCB Business Register (needs approval)

**Status:** *Needs approval.* There is no adapter yet. The dashboard shows Sweden as "Needs approval" and generates no companies.

| Option | What it offers | Status |
|---|---|---|
| **SCB free Business Register API**, `https://privateapi.scb.se/nv0101/v1/sokpavar` | Current company and workplace data: SNI, addresses, employee size classes. Up to 2 000 rows per call with pagination. Nightly refresh, but not every field updates nightly. **No changes-only function.** | Access needs a **client certificate + password** from SCB (`scbforetag@scb.se`) after accepting the terms. The request/response schema (`…/sokpavar/help`) sits behind that access, and the host was unreachable from the test environment. |
| SCB notification service | Change notifications | To evaluate once access exists |
| Bolagsverket "värdefulla datamängder" API | Lookup by organisation number only (OAuth2) | Lookup only, not a daily feed |
| Bolagsverket bulk file | All organisations | Weekly (periodic) |

**Owner actions:**
1. Request SCB access, stating which data layouts you need.
2. Store the certificate on the server.
3. From the help endpoint, confirm whether a registration-date or start-date field and filter exist, and whether phone or email fields are available.

Then implement `scb.ts` against that verified schema with `freshness: "DAILY"`. Never claim REAL_TIME for a nightly refresh.
