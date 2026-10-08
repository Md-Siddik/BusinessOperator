# 🇳🇴 Norway: Brønnøysundregistrene (Enhetsregisteret)

| | |
|---|---|
| Provider id | `brreg` (`src/features/registry/providers/brreg.ts`) |
| Official source | Brønnøysundregistrene, Enhetsregisteret (Central Coordinating Register for Legal Entities) |
| API documentation | https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html |
| Authentication | None. Public open-data API. |
| Data freshness | **Real-time.** The API serves the live register. |
| Scheduled sync | Every 30 minutes (default) |
| Official record link | `https://virksomhet.brreg.no/nb/oppslag/enheter/{orgnr}` |

## Endpoints used

- Daily list: `GET /enheter?fraRegistreringsdatoEnhetsregisteret=YYYY-MM-DD&tilRegistreringsdatoEnhetsregisteret=YYYY-MM-DD&size=500&page=N`. The API allows `(page + 1) × size ≤ 10 000` per query.
- Single company: `GET /enheter/{orgnr}`
- Roles: `GET /enheter/{orgnr}/roller`
- Search: `GET /enheter?navn=…` or `?organisasjonsnummer=…`

## Fields mapped

| Field | Source field |
|---|---|
| Organisation number | `organisasjonsnummer` |
| Name | `navn` |
| Registration date | `registreringsdatoEnhetsregisteret` |
| Founding date | `stiftelsesdato` |
| Legal form | `organisasjonsform.beskrivelse` / `kode` |
| Status | `konkurs`, `underAvvikling`, `underTvangsavviklingEllerTvangsopplosning`, `slettedato` |
| Industry | `naeringskode1` (SN2007/NACE). "00.000 Uoppgitt" is treated as missing. |
| Business activity | `aktivitet[]` |
| Purpose | `vedtektsfestetFormaal[]` |
| Email / phone / mobile / website | `epostadresse`, `telefon`, `mobil`, `hjemmeside` |
| Business / postal address | `forretningsadresse`, `postadresse` (municipality = `kommune`) |
| Employees | `antallAnsatte` (only if `harRegistrertAntallAnsatte`) |
| People / roles | `/roller`: active roles only. The contact person is picked in this order: Kontaktperson → Daglig leder → Innehaver → Styrets leder. **Birth dates are not stored.** |

## What to expect

Contact fields are published only when the entity has registered them. Most brand-new companies have not: in a live sample of 500 new registrations, 22 had an email, 17 a mobile and 11 a website. The dashboard shows "Not available from registry" for the rest. Use **Find contact details** to check the company's website.

Roles are fetched during sync for companies registered in the last 2 days (capped by `REGISTRY_PEOPLE_PER_RUN`). For older companies they load when the profile is first opened.

## Incremental update feed (live)

`GET /oppdateringer/enheter?oppdateringsid={next}&size=200` (inclusive id). `endringstype`: **Ny** (a new legal entity; its details are fetched), **Endring** / **Sletting** (a known company is refreshed and re-queued for research), **Fjernet** (removed: our copy is deleted). The cursor is stored in `checkpoints` (`feed:brreg`) after records are stored. Polled every 60 s (`NORWAY_FEED_POLL_SECONDS`).

**Measured on Saturday 4 Oct 2026, 00:00–14:40 UTC:** 127 updates (22 Ny, 88 Endring, 17 Sletting) published at 60 distinct times. The median gap between publications was **5.0 min** (p90 20 min, max 4 h overnight). The newest batch was 25 s old when measured. So the search API is real-time and the update feed is near-real-time in roughly 5-minute batches. With 60 s polling, a new entity reaches the dashboard within about one batch interval plus one poll. Per-event delays (source `dato` → stored) are recorded in `checkpoints.delaySamples` and shown on Data Sources once events arrive.

Subunits (`underenheter`) come from a different endpoint and are **not** imported as new companies.

## Rate limits

No published hard limit. The client sends at most 4 requests per second, retries with exponential backoff on 429/5xx, and pauses the provider (circuit breaker) after 5 consecutive failures.

## Setup

Nothing to configure. To point at a mirror or test environment, set `BRREG_API_URL`.
