# 🇫🇷 France: INSEE API Sirene 3.11

| | |
|---|---|
| Provider id | `insee-sirene` (`src/features/registry/providers/insee-sirene.ts`) |
| Official source | INSEE, Sirene business register |
| API documentation | https://portail-api.insee.fr/ (catalogue → API Sirene) |
| Authentication | Free API key in the header `X-INSEE-Api-Key-Integration` |
| Data freshness | **Daily** (Sirene is updated every night) |
| Scheduled sync | Once a day (default) |
| Official record link | `https://annuaire-entreprises.data.gouv.fr/entreprise/{siren}` |

## Endpoint used

`GET /siret?q=dateCreationUniteLegale:[D TO D] AND etablissementSiege:true&nombre=1000&curseur=*` returns the head office of each legal unit, using cursor pagination.

## Important behaviour

- `dateCreationUniteLegale` is the legal **creation date**. New units often appear in Sirene a few days after that date, so a given day's count keeps growing for several days. The incremental sync re-checks recent days to pick this up.
- Units with partial diffusion (`statutDiffusionUniteLegale` ≠ `O`) are **skipped**: these are people who opted out of publication.
- Sole traders (catégorie juridique 1000) are skipped unless `FRANCE_INCLUDE_SOLE_TRADERS=true`, because they are natural persons.

## Fields mapped

SIREN, name (dénomination), creation date, administrative status, legal category (the most common codes are named; others are shown as their code), NAF code (whose first four digits map to the NACE class), and head-office address.

## What it does not provide

Sirene has **no email, phone or website** data.

## Rate limits

30 requests per minute. The client spaces requests by at least 2.1 s.

## Setup

1. Create an account at https://portail-api.insee.fr/.
2. Create an application and subscribe it to **API Sirene** (public plan).
3. Copy the API key and add `FRANCE_SIRENE_API_KEY=<key>` to the server environment.
4. Restart, then verify with `npm run registry:verify -- FR`.
