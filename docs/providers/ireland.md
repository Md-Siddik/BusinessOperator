# 🇮🇪 Ireland: CRO open data

| | |
|---|---|
| Adapter | `cro` (`src/features/registry/providers/cro.ts`) |
| Source | Companies Registration Office, "Company Records" dataset (CKAN) |
| Docs | https://opendata.cro.ie/dataset/companies |
| Access | Open, no key. Licence CC BY 4.0, which requires attribution to the CRO. |
| Query | `datastore_search_sql`, filtered on `company_reg_date` for the day range, with count + `LIMIT/OFFSET` pagination (1 000 rows per page) |
| Date meaning | `company_reg_date`: the date the company was registered |
| Contacts | None. Address and Eircode only. |
| Freshness | The publisher states daily. Measured on 4 Oct 2026: the resource was last modified 30 Sep 2026 and the newest registration date was 29 Sep. The adapter reports the dataset's modification time as "Latest source publication", so the lag is visible. |
| Status | **Real-data tested.** A 7-day backfill imported 241 companies (registrations 27–29 Sep 2026). |

Placeholder addresses (`********NO ADDRESS DETAILS*******`) are dropped. NACE codes are mapped from `nace_v2_code` (e.g. 7022 → 70.22). Business names (a separate register) are not included.
