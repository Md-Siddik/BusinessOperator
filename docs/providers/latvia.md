# 🇱🇻 Latvia: Register of Enterprises (UR) open data

| | |
|---|---|
| Adapter | `ur-lv` (`src/features/registry/providers/ur-lv.ts`) |
| Dataset | https://data.gov.lv/dati/eng/dataset/uz ("Uzņēmumu reģistra atvērtie dati"), an EU High-Value Dataset under Implementing Regulation (EU) 2023/138 |
| File | `register.csv`, `;`-separated, UTF-8 with BOM, about 130 MB, about 490 000 entities. Default URL is in the adapter; override with `LATVIA_UR_REGISTER_URL`. |
| Licence | CC0 1.0 |
| Access | Open. No account, no key. |
| Update | Daily. Last-Modified observed at about 20:25 UTC, and the file already contains that day's registrations. |
| Registration date | `registered`: the date the entity was entered in the register |
| Imported | Registers `K` (Commercial Register: SIA, AS, IK, branches `AKF`, …) and `U` (Enterprise Register: farms and other undertakings) |
| Not imported | Associations and foundations (`B`), mass media (`M`), and the political, religious and other registers |
| Fields | Registration number, name, legal form (`type`, `type_text`), registered / terminated, legal address (municipality, city, street), postcode (`LV-####`) |
| Not provided | Industry code, email, phone, website, people. Contacts come from the research step ("Find contact details"). |

## How the sync works

The file has no query API. Each sync makes one `HEAD` request and compares the `ETag`. When the file has changed, the adapter streams it once, line by line, and keeps only rows registered in the last 400 days, or earlier when an older window is requested. Later syncs reuse the parsed rows until the publisher's `ETag` changes. That means about one 130 MB download per publication, not one per sync.

## Verified

- 18 Oct 2026, `npm run registry:verify -- LV`: 16 Oct returned 41 real registrations with addresses. That day had 46 entries in total, so 5 were associations or other non-business registers.
- The first download took about 50–80 s from this environment.
