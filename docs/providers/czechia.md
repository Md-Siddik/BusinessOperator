# 🇨🇿 Czechia: ARES public-register new entries

| | |
|---|---|
| Provider id | `ares-cz` (`src/features/registry/providers/ares-cz.ts`) |
| Official source | ARES (Administrativní registr ekonomických subjektů), Ministry of Finance of the Czech Republic |
| API documentation | https://ares.gov.cz/stranky/vyvojar-info · Swagger: https://ares.gov.cz/swagger-ui/ |
| Authentication | None (public API) |
| Data freshness | **Daily**: notification batches on working days, 1–3 days after the court registers the entity |
| Scheduled sync | Every 3 hours (default) |
| Official record link | `https://ares.gov.cz/ekonomicke-subjekty?ico={ico}` |

## Why notification batches

The ARES search (`/ekonomicke-subjekty/vyhledat`) has **no date filter**, so it cannot list new companies. ARES does publish numbered notification batches per source register. For the public register (`vr`) each batch lists IČO numbers with a change type: `INS` (inserted), `UPD`, `DEL`.

## Endpoints used

1. `POST /ekonomicke-subjekty-notifikace/vyhledat` with body `{"datovyZdroj":"vr"}` lists the batches (`cisloDavky`, `datumUvolneniDavky`, `pocetZmen`).
2. `GET /ekonomicke-subjekty-notifikace/datovy-zdroj/vr/cislo-davky/{n}` returns the changes in one batch. Only `INS` entries with an 8-digit IČO are kept.
3. `GET /ekonomicke-subjekty-vr/{ico}` returns the public-register record (primary `zaznamy` entry).

## Mapping

| Field | Source |
|---|---|
| Registration date | `datumZapisu`, the date of entry in the public register (the day the company comes into existence) |
| Name / legal form | current `obchodniJmeno` / `pravniForma` (code mapped to its name) |
| Address | current `adresy` entry with `typAdresy: "SIDLO"` |
| Activity | current `cinnosti.predmetPodnikani` |
| Contact person | first current member of `statutarniOrgany` (e.g. "Jednatel"). Name and role only; birth dates and home addresses are **not** stored |

## Filters

- **Re-inserted old entities**: an `INS` whose `datumZapisu` is more than 60 days before the batch date is not a new registration and is skipped (seen in real batches, e.g. a 2011 cooperative in liquidation).
- **Business forms only** by default: s.r.o. (112), a.s. (121), v.o.s. (111), k.s. (113), družstvo (205), European forms (931–933) and foreign branches (421, stored as `BRANCH`). Associations, foundations, unit-owner associations and other non-profits only with `CZECHIA_INCLUDE_NON_PROFITS=true`.

## Limits

- No email, phone, website or industry code for new entities. Contacts come from website research.
- One request per inserted entity, at ≤ 4 requests/second (≈ 1 minute for a typical batch day).
- Verified 18 Oct 2026: the batch of 17 Oct had 258 inserted entities, of which 247 were imported.
