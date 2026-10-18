# 🇨🇭 Switzerland: SHAB / FOSC commercial-register new entries (HR01)

| | |
|---|---|
| Adapter | `shab` (`src/features/registry/providers/shab.ts`) |
| API | Official Gazettes Portal (Amtsblattportal), operated by SECO. Docs: https://amtsblattportal.ch/docs/api/ |
| Access | Open. The docs state: "The API is freely accessible for anyone to use", and no user profile is required for published data. No key. |
| List | `GET /api/v1/publications?publicationStates=PUBLISHED&subRubrics=HR01&tenant=shab&publicationDate.start=D&publicationDate.end=D&pageRequest.size=2000`. The adapter makes one request per publication day; a day has about 200–250 new entries. |
| Detail | `GET /api/v1/publications/{id}/xml` (schema `HR01-export.xsd`): `commonsNew.company` (name, UID, seat, legal-form code, address), `purpose`, `journalDate`, `publicationText` |
| Source link | `GET /api/v1/publications/{id}/pdf`, the signed PDF. The operator states that only the signed PDF is legally binding. |
| Registration date | `journalDate` (Tagebuchdatum), the day the cantonal commercial register entered the company. The entry is legally effective from that day. |
| Publication lag | SHAB publishes an entry 1–5 working days after its journal date. The provider sets `windowBy: "publication"`: a sync window selects entries **published** in the window and stores each under its real journal date. The sync engine also rebuilds the daily counts of those earlier days (at most 31 days back). |
| Imported | New entries (GmbH, AG, cooperatives, partnerships, associations, foundations). Branches are marked `BRANCH`. |
| Not imported | Sole proprietorships (legal-form code `0101`). They are natural persons, so set `SWITZERLAND_INCLUDE_SOLE_TRADERS=true` to include them. |
| Not provided | Industry code, email, phone, website. Contacts come from the research step. |
| Legal form | Taken from the publication text as published (for example "Gesellschaft mit beschränkter Haftung"). The numeric code is kept as `legalFormCode`. No code-to-name table is invented. |

## What "today" shows

Because of the publication lag, today's registration count for Switzerland is usually 0 in the morning and fills in over the next working days. The **First received** view shows what arrived today.

## Verified

- 18 Oct 2026, `npm run registry:verify -- CH`: 233 entries were published on 16 Oct. 156 were imported (journal dates 13–15 Oct) and 77 sole proprietorships were excluded. Two consecutive runs returned the same 156.
