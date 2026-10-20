# 🇪🇪 Estonia: e-Business Register (RIK)

Two adapters exist. The **default is the open-data file**, which needs no agreement. The XML services adapter stays available for the contact fields once RIK grants access. Switch between them in Settings → Countries.

## Default: open data, "Basic data" file (live)

| | |
|---|---|
| Adapter | `rik-open-data` (`src/features/registry/providers/rik-open-data.ts`) |
| File | `https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip`, a ZIP with one `;`-separated CSV, about 19 MB (override with `ESTONIA_RIK_OPEN_DATA_URL`) |
| Docs | https://avaandmed.ariregister.rik.ee/en/downloading-open-data |
| Licence | CC BY 4.0, attribution to RIK. GDPR applies to any personal data. |
| Access | Free download, no account or key |
| Update | Daily. Last-Modified observed at about 08:24 Europe/Tallinn, containing the previous day's entries. |
| Registration date | `ettevotja_esmakande_kpv`: the date of first entry in the register (`dd.mm.yyyy`) |
| Scope | Entities currently in the register (entered, in liquidation, bankrupt). Sole traders (FIE, natural persons) are excluded unless `ESTONIA_INCLUDE_SOLE_TRADERS=true`. |
| Fields | Name, registry code, legal form, status, address (street, EHAK area, postcode), official registry link (`teabesysteemi_link`) |
| Not provided | Industry, email, phone, website. The much larger "General data" JSON file (about 230 MB) has contacts and activity codes, but it is not used yet. |
| How it syncs | One `HEAD` request (ETag) per sync. The file is downloaded and parsed only when it changes, and the last 400 days are kept in memory. |
| Verified | 18 Oct 2026: 16 Oct returned 83 real registrations, each with its official registry link. |

## Alternative: XML services (needs a RIK agreement)

| | |
|---|---|
| Adapter | `rik` (`src/features/registry/providers/rik.ts`) |
| Docs | https://avaandmed.ariregister.rik.ee/en/open-data-api/introduction-api-services |
| Endpoint | `https://ariregxmlv6.rik.ee/` (WSDL `?wsdl`; test environment `https://demo-ariregxmlv6.rik.ee`), SOAP, namespace `http://arireg.x-road.eu/producer/` |
| Operations | `arireg.ettevotjaMuudatusedTasuline_v1` (changes for one date, 500 per page via `tulemuste_lk`) and `arireg.detailandmed_v2` with `yandmed=1`. Personnel data (`iandmed`) is **not** requested. |
| Account | Agreement with RIK: https://ariregister.rik.ee/eng/contract/step1 (reviewed within 5 working days). API-only use is documented as free. |
| Limits | 50 000 query answers per day, 1 simultaneous query |
| Application variables | `ESTONIA_RIK_USERNAME`, `ESTONIA_RIK_PASSWORD` (e-Business Register user name and password), optional `ESTONIA_RIK_API_URL` |
| First registrations | Identified from `yldandmed.esmaregistreerimise_kpv`, the first registration date in the detail record. The entry-type classifier code was not verified, so it is not relied on. |
| Contacts | `sidevahendid` (`liik` EMAIL / TEL / MOB / WWW, `sisu`) |
| XML safety | Parsed with `fast-xml-parser` with entity processing disabled. Request values are XML-escaped. |
| Status | **Documented / needs approval.** Built from the published element names and not yet authenticated. Run `npm run registry:verify -- EE` once credentials are issued, and check the element paths against a real response. |
