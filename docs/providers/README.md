# Data providers

ExploreTechify retrieves **company registrations** and **business contact data** from real, legitimate sources only. It never sends email, SMS or messages through a provider. Communication is manual: you copy contacts, open websites, prepare quotation drafts and record follow-ups.

Per-jurisdiction research covering all 56 European jurisdictions: [`docs/coverage/jurisdictions.md`](../coverage/jurisdictions.md). It is generated from `src/config/jurisdictions.ts`.

## Registration sources

The "Status (4 Oct 2026)" column uses these levels: **Documented** → **Configured** → **Authenticated** → **Real-data tested** → **Freshness measured**.

| Country | Adapter | Source | Status (4 Oct 2026) | Freshness | Contact fields from the source | Docs |
|---|---|---|---|---|---|---|
| 🇳🇴 Norway | `brreg` | Brønnøysundregistrene — `/enheter`, `/enheter/{orgnr}`, `/oppdateringer/enheter` | **Freshness measured.** Live, no key. | Search: real-time. Update feed: near-real-time, published in about 5-minute batches. | Email, phone, mobile, website (when registered) | [norway.md](norway.md) |
| 🇫🇮 Finland | `prh` | PRH YTJ open data v3 | **Real-data tested.** Live, no key. | Daily | Website only | [finland.md](finland.md) |
| 🇮🇪 Ireland | `cro` | CRO open data (CKAN `datastore_search_sql`) | **Real-data tested.** Live, no key. | Labelled daily by the publisher; the observed lag is shown on Data Sources | None | [ireland.md](ireland.md) |
| 🇬🇧 United Kingdom | `companies-house` + streaming worker | Companies House REST + Streaming API | **Documented.** Needs 2 free keys. | REST: current data. Stream: changes as published. | None | [united-kingdom.md](united-kingdom.md) |
| 🇳🇱 Netherlands | `kvk` | KVK Mutatieservice + Basisprofiel | **Documented**, and checked against KVK's public test environment. Needs a paid subscription. | Near real-time (KVK: within 15 minutes) | None (non-mailing flag honoured) | [netherlands.md](netherlands.md) |
| 🇪🇪 Estonia | `rik-open-data` (default) | RIK open data, daily "Basic data" file | **Real-data tested.** Live, no key. | Daily | None | [estonia.md](estonia.md) |
| 🇪🇪 Estonia | `rik` (alternative) | RIK XML services (`ettevotjaMuudatusedTasuline_v1`, `detailandmed_v2`) | **Documented.** Needs an agreement. | Real-time XML services (to be measured) | Email, phone, mobile, website (`sidevahendid`) | [estonia.md](estonia.md) |
| 🇱🇻 Latvia | `ur-lv` | UR open data, daily `register.csv` (EU HVD) | **Real-data tested.** Live, no key. | Daily | None | [latvia.md](latvia.md) |
| 🇨🇭 Switzerland | `shab` | SHAB HR01 new entries (Official Gazettes Portal API) | **Real-data tested.** Live, no key. | Daily; published 1–5 working days after the journal date | None | [switzerland.md](switzerland.md) |
| 🇫🇷 France | `bodacc` (default) | BODACC A "Créations", DILA open data (Opendatasoft API) | **Real-data tested** (18 Oct 2026). Live, no key. | Daily (publication days); registrations appear a few days later | None. Officers (Président, Gérant …) as registry contact person | [france.md](france.md) |
| 🇫🇷 France | `insee-sirene` (alternative) | INSEE API Sirene 3.11 | **Documented.** Needs a free key. | Daily | None | [france.md](france.md) |
| 🇨🇿 Czechia | `ares-cz` | ARES notification batches (public register) + `/ekonomicke-subjekty-vr/{ico}` | **Real-data tested** (18 Oct 2026). Live, no key. | Daily batches (working days), 1–3 days after registration | None. Statutory body (jednatel …) as registry contact person | [czechia.md](czechia.md) |
| 🇩🇪 Germany | `openregister` | OpenRegister (commercial) | **Documented.** Needs a key. | Unknown until measured | Not evidenced | [germany.md](germany.md) |
| 🇩🇰 Denmark | `cvr` | CVR system-to-system | **Documented.** Needs credentials. | Continuous (to be measured) | Email, phone, website (reklamebeskyttelse honoured) | [denmark.md](denmark.md) |
| 🇸🇪 Sweden | — | SCB Business Register API | **Needs approval** (client certificate). No adapter yet. | Nightly (per SCB) | Not yet verified | [sweden.md](sweden.md) |
| 🇸🇰 Slovakia | — | RPO API (Statistical Office) | **Under research.** The endpoint did not respond in testing. | Daily (per publisher) | — | [coverage](../coverage/jurisdictions.md) |
| Any jurisdiction | `opencorporates-xx` | OpenCorporates (commercial fallback) | **Documented.** Needs a token and a licence check per jurisdiction. | Unknown | None | [contact-data.md](contact-data.md#opencorporates) |

## Contact-data providers (retrieval only)

| Provider | Used for | Application variable | Credential type | Docs |
|---|---|---|---|---|
| Company website (built-in) | Contact, About, Team, Impressum and legal pages: emails, phone numbers, contact forms, and people named with a role in schema.org structured data | — | — | [contact-data.md](contact-data.md) |
| Hunter | Domain Search (sourced emails), Email Verifier, Domain Finder (beta, candidates only) | `HUNTER_API_KEY` | Account API key | [contact-data.md](contact-data.md#hunter) |
| Apollo | Organization enrichment: corporate phone for a **confirmed** domain | `APOLLO_API_KEY` | Account API key (`x-api-key`) | [contact-data.md](contact-data.md#apollo) |
| Brave Search API | Finds candidate websites and public business pages. Every candidate is verified by registration number before use. | `BRAVE_SEARCH_API_KEY` | Subscription token (`X-Subscription-Token`) | [contact-data.md](contact-data.md#brave) |

Paid providers are disabled by default. They run only when enabled in **Settings → Research**, within the daily, monthly and per-company budgets. A budget of 0 means paid calls are paused.

## How it fits together

```
Registry source ──► ingest (dedupe, provenance merge, firstSeenAt) ──► Company table appears immediately
      │ live feeds (Brreg updates, KVK signals, RIK changes, Companies House stream)
      ▼
Research job queue (durable, retries 1/3/7/14/30 days, budgets, cache, dead-letter)
  registry re-check → official website (and verified discovery) → Hunter / Apollo → verification
      ▼
Contact provenance (source, ownership, verification, review) ──► direct-contact ranking ──► Today (contact-first)
      ▼
Service fit (evidence only) ─► eligibility review ─► quotation draft ─► manual contact log
```

Key rules:
- **Today** uses the source's own registration date, never import time.
- **First received** and **Contacts found** are separate daily views.
- New companies are listed **contact first**: those with a usable email or phone sort ahead. The ordering is applied in the database before pagination, so it holds in the UI, search and exports.
- **Never counted as direct contacts:** shared, intermediary, placeholder, masked, no-reply, invoice-only and unreviewed values.
- **Never written to exports:** contacts of restricted or do-not-contact companies, and suppressed addresses.

## Adding a registration source

1. Implement `CompanyRegistryProvider` (`src/features/registry/types.ts`). Use `brreg.ts` as the reference. Declare honest `capabilities`, `freshness`, `accessType` and `registrationDateType`. Implement `pollChanges` if the source has a change feed.
2. Register it in `src/features/registry/providers/index.ts`, and list it in the jurisdiction's `providers` in `src/config/jurisdictions.ts`.
3. Run `npm run registry:verify -- XX` against the real source. Raise `evidence` only as far as you actually verified.
4. Run `npm run coverage:report` to regenerate the coverage report.
