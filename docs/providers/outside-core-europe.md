# Poland, United States, Canada, Australia, Japan

Adapters added on 27 Oct 2026. Every source was called live on 26–27 Oct 2026 (except Japan, which needs an application ID); responses below are what the sources actually returned. Unit tests use fixtures shaped like those responses (`tests/registry-world.test.ts`).

## 🇵🇱 Poland — `krs-pl`

- **Source:** Ministry of Justice KRS open API, no key. `GET /api/krs/Biuletyn/{YYYY-MM-DD}` returns the KRS numbers with any entry that day; `GET /api/krs/OdpisAktualny/{krs}?rejestr=P&format=json` returns the current extract. Docs: https://prs.ms.gov.pl/krs/openApi
- **New registrations:** a company is imported only when its extract's `naglowekA.dataRejestracjiWKRS` equals the bulletin day. KRS numbers are sequential, so the scan walks the bulletin from the highest number down and stops after `POLAND_KRS_STOP_AFTER` (default 40) consecutive extracts registered earlier. Requests are serialized at 250 ms.
- **Same day:** the 26 Oct 2026 bulletin was available at 21:10 Europe/Warsaw the same day (3 414 entries, highest KRS 0001275289).
- **Fields:** name, legal form, KRS number, address (`siedzibaIAdres`), PKD 2025 main activity (→ NACE division.class), email / website when registered. Board names are masked by the public API and are not stored. Branches of foreign companies use `danePodmiotuZagranicznego` and are marked `BRANCH`. Associations (register S) return 404 for `rejestr=P` and are skipped.

## 🇺🇸 United States — `us-state-open-data`

- **Sources (Socrata SODA, no key):** New York DOS "Active Corporations: Beginning 1800" (`data.ny.gov` `n9v6-gdp6`, `initial_dos_filing_date`), Colorado SOS "Business Entities in Colorado" (`data.colorado.gov` `4ykn-tg5h`, `entityformdate`), Connecticut SOTS "Business Registry – Business Master" (`data.ct.gov` `n7gp-d28j`, `date_registration`), Oregon SOS "Active Businesses – ALL" (`data.oregon.gov` `tckn-sxa6`, `registry_date`; added 27 Oct 2026 — refreshed daily, ~1 day lag, one row per address / representative, grouped per `registry_number`).
- **Freshness (26 Oct 2026):** all three refreshed that day; newest dates NY 24 Oct, CO 24 Oct, CT 25 Oct → 1–3 days. Incremental syncs re-read 5 days (`lookbackDays`).
- **Identity:** `NY-<dos_id>`, `CO-<entityid>`, `CT-<accountnumber>`, `OR-<registry_number>` — deduplicated per state register.
- **Rules:** not-for-profits excluded (`entity_type` NOT-FOR-PROFIT, CO `DNC`/`FNC`, CT `Non-Stock`, OR nonprofits + assumed business names / reserved names); foreign qualifications kept and marked `BRANCH` (not counted as new companies). Connecticut publishes `business_email_address`; NY corporations may name a chairman; Oregon names an authorized representative or a registered agent who is a person. No phones or websites.
- **Optional:** `US_SOCRATA_APP_TOKEN` raises rate limits.

## 🇨🇦 Canada — `corporations-canada`

- **Source:** Corporations Canada "Federal Corporations" open data (Open Government Licence – Canada), daily CSV `corporations-active-cbca-en.csv` (~100 MB, modified 26 Oct 2026 11:06 UTC). Streamed once per publication (Last-Modified) through the shared bulk-file cache.
- **Date:** "Anniversary date" — the date of incorporation, amalgamation or continuance (labelled as such).
- **Identity:** `FED-<corporation number>`. Federal corporations only; provincial registers are not included.

## 🇦🇺 Australia — `asic-au`

- **Source:** ASIC Company Dataset on data.gov.au (CC BY 3.0 AU), CKAN DataStore filtered by `"Date of Registration": "dd/mm/yyyy"`. ASIC publishes a new resource each month, so the current resource is resolved from the dataset on every run.
- **Freshness:** refreshed daily; on 27 Oct 2026 (Sydney) the dataset held 1 008 registrations for 23 Oct and 19 for 26 Oct — the newest day is partial until the next refresh. Incremental syncs re-read 4 days.
- **Fields:** company name (current names only), ACN, type, status. The open dataset has no address or contact fields.

## 🇯🇵 Japan — `nta-jp` (credentials required, not run live)

- **Source:** National Tax Agency Corporate Number Publication Site Web-API v4, period endpoint `/4/diff?id=<appId>&from=&to=&type=12&divide=n` (XML). Needs a free application ID: `JAPAN_HOUJIN_APP_ID`.
- **New companies:** `process` = `01` (new designation) and a company `kind` (301–305, 399, 401).
- **Date:** corporate number designation date (法人番号指定年月日). It follows commercial registration and is labelled as such — never as the registration date.
- **Status:** written against the published specification. It has **not** been run against the live API; once the ID is set, run `npm run registry:verify -- JP` before relying on it.
