# 🇳🇱 Netherlands: KVK Mutatieservice + Basisprofiel

| | |
|---|---|
| Adapter | `kvk` (`src/features/registry/providers/kvk.ts`) |
| Docs | https://developers.kvk.nl/documentation/mutatieservice-api (OpenAPI: `api-kms.yaml`) |
| Endpoints | `GET /v1/abonnementen` · `GET /v1/abonnementen/{id}?vanaf&tot&pagina&aantal` (RFC3339, `aantal` 10–500) · `GET /v1/abonnementen/{id}/signalen/{signaalId}` · `GET /v1/basisprofielen/{kvkNummer}` |
| Auth | `apikey` header |
| Account | Paid KVK API subscription (Mutatieservice + Basisprofiel). See https://developers.kvk.nl/pricing for current rates; amounts were not verified here. |
| Application variables | `NL_KVK_API_KEY`, optional `NL_KVK_SUBSCRIPTION_ID` (otherwise the first active subscription is used), `NL_KVK_API_URL` |
| New formation | `signaalType = SignaalNieuweInschrijving`, `heeftNieuweGegevens.aanleiding.code = "NW"`. Other reason codes are stored as non-new events (`KVK_<code>`), kept out of new-company counts and listed under "Other events" for review. |
| Date meaning | `startdatum` (YYYYMMDD). Invalid dates are rejected, never guessed. |
| Contacts | None in signals or Basisprofiel. `indNonMailing = Ja` makes the company **Restricted** for outreach. |
| Freshness | NEAR_REAL_TIME. KVK documents signal delivery within 15 minutes. The feed is polled every 60 s (`NL_FEED_POLL_SECONDS`). |
| Status | **Documented.** Requests and response parsing were checked against KVK's public **test** environment (`api.kvk.nl/test/api`, fictional data). The test environment is refused in production. |

**Connection test:** set the key, restart, then open Data Sources → Netherlands → **Check now**, then `npm run registry:verify -- NL`.
