# 🇩🇰 Denmark: CVR system-to-system access

| | |
|---|---|
| Provider id | `cvr` (`src/features/registry/providers/cvr.ts`) |
| Official source | Det Centrale Virksomhedsregister (CVR), Erhvervsstyrelsen (Danish Business Authority) |
| Access guide | https://erhvervsstyrelsen.dk/vejledning-adgang-til-cvr-data-system-til-system |
| Authentication | Username and password issued by Erhvervsstyrelsen (HTTP Basic auth) |
| Data freshness | **Real-time.** The distribution is updated continuously. |
| Scheduled sync | Every 60 minutes (default) |
| Official record link | `https://datacvr.virk.dk/enhed/virksomhed/{cvr}` |

## Endpoint used

`POST http://distribution.virk.dk/cvr-permanent/virksomhed/_search` (Elasticsearch) with a range query on `Vrvirksomhed.livsforloeb.periode.gyldigFra`. Results are paged with `from`/`size`; the cluster limits `from + size` to 3000.

## Fields mapped

CVR number, latest name, start / founding date, composite status, company form, main industry (DB07, whose first four digits map to the NACE class), address, and the current **email, phone and website** when registered. Contact details marked `hemmelig` (secret) are skipped.

## Advertising protection

Companies registered with **reklamebeskyttelse** (`reklamebeskyttet: true`) are flagged *No marketing* in the dashboard and are **excluded from outreach drafts and campaigns**. Danish law forbids direct marketing to them.

## Status

Implemented against Erhvervsstyrelsen's published field documentation. Run `npm run registry:verify -- DK` after the credentials are issued to confirm the mapping against live data.

## Setup

1. Email **cvrselvbetjening@erst.dk** to request system-to-system access to CVR data. Describe the use: B2B prospecting, which must respect reklamebeskyttelse.
2. Add `DENMARK_CVR_USERNAME` and `DENMARK_CVR_PASSWORD` to the server environment.
3. Restart, then verify with `npm run registry:verify -- DK`.
