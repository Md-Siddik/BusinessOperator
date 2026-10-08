# 🇪🇪 Estonia: e-Business Register (RIK) XML services

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
