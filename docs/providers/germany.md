# 🇩🇪 Germany: OpenRegister (commercial)

Germany has **no official registry API**. handelsregister.de does not permit automated bulk retrieval, and the register is split across about 150 local courts.

| | |
|---|---|
| Adapter | `openregister` (`src/features/registry/providers/openregister.ts`) |
| Docs | https://docs.openregister.de/endpoint/filter-company |
| Endpoint | `POST https://api.openregister.de/v1/search/company`, `Authorization: Bearer <key>` |
| Query | `filters: [{ field: "incorporated_at", min: D, max: D }]`, one day at a time; `page` / `per_page` pagination (`total_pages`, `total_results`) |
| Account | OpenRegister account. The docs mention 500 free credits per month; paid plans beyond that. |
| Application variable | `OPENREGISTER_API_KEY` |
| Registration number | `register_type register_number, register_court` (e.g. `HRB 12345, Amtsgericht Charlottenburg`), deduplicated per court |
| Contacts | Not evidenced in search results. Contacts come from website research. |
| Freshness | **UNKNOWN** until measured. The provider's "within 24 hours" claim and its response speed are not treated as proof. |
| Status | **Documented.** The result-array field name is parsed defensively (`results` / `companies`) and must be confirmed with the first authenticated call. |

Alternatives to evaluate if OpenRegister doesn't fit: North Data, handelsregister.ai, OpenCorporates (fallback).
