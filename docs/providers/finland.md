# 🇫🇮 Finland: PRH, YTJ open data API v3

| | |
|---|---|
| Provider id | `prh` (`src/features/registry/providers/prh.ts`) |
| Official source | Finnish Patent and Registration Office (PRH), Business Information System (YTJ) |
| API documentation | https://avoindata.prh.fi/en/ytj/swagger-ui |
| Authentication | None. Public open data. |
| Data freshness | **Daily** |
| Scheduled sync | Every 6 hours (default) |
| Official record link | `https://tietopalvelu.ytj.fi/yritys/{businessId}` |

## Endpoints used

- Daily list: `GET /opendata-ytj-api/v3/companies?registrationDateStart=D&registrationDateEnd=D&page=N` (100 per page, pages start at 1)
- Single company: `GET /companies?businessId=…`

## Fields mapped

Business ID (`businessId.value`), current name (`names[]` without an end date), registration date (`registrationDate`), company form (English description), status (current company situation or register entry), main business line (`mainBusinessLine`, TOL 2008, whose first four digits equal the NACE class), website (`website.url`), visiting and postal addresses (`addresses[]` type 1 and 2), and last modified (`lastModified`).

## What it does not provide

The open data contains **no email addresses and no phone numbers**, and no persons or roles. The dashboard says "Not published by this registry" for those fields. Use **Find contact details** to check the company's website.

## Rate limits

Not published. The client spaces requests by at least 400 ms, with retries, backoff and the circuit breaker.

## Setup

Nothing to configure (`FINLAND_PRH_API_URL` optionally overrides the base URL).
