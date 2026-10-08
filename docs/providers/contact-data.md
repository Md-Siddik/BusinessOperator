# Contact-data and search providers

**Scope.** Retrieval only. ExploreTechify does not use any provider's sending, sequence, campaign or dialler features, and never sends quotations.

## Research sequence (per company, bounded)

| Step | Source | Cost | Result kinds |
|---|---|---|---|
| 1 | Official registry re-check (`getCompany`) | Free | Registry email, phone, mobile, website (ownership: confirmed) |
| 2a | Known website: homepage plus up to *N* Contact / About / Team / Impressum / legal-notice pages | Free | Emails, phones, contact-form links (source page and time recorded) |
| 2b | No website: plausible own-domain check, accepted only if the page shows the **registration number** or **exact legal name** | Free | Website (name-only matches go to review) |
| 2c | Web search (Brave), if enabled | Paid | Candidate pages. Accepted only if they show the registration number. Third-party pages go to review. |
| 3 | Hunter Domain Search, if a domain is confirmed and enabled | Paid | Sourced emails. Named personal addresses go to review. |
| 3 | Hunter Domain Finder (beta), if no domain | Paid | Candidate domains, sent to review only |
| 3 | Apollo organization enrichment, if a domain is confirmed and enabled | Paid | Corporate phone. A name mismatch sends it to review. |
| 4 | Free MX check, then optional Hunter Email Verifier | Free / paid | Deliverable / catch-all / invalid / unknown |

Classification rules:
- **Direct contact** means a usable email or phone that is source-supported and owned by the company (or approved by a person in review).
- A value used by 3 or more different companies (configurable) is marked **intermediary**: an agent, accountant or registered-office provider.
- A website shared with another company becomes a **group-level route**, unless the page shows this company's registration number.
- Placeholders, masked values, registry/administrator addresses, no-reply addresses and purpose-restricted addresses (invoice@, privacy@, jobs@ …) are never counted.
- Catch-all is **not** treated as a confirmed mailbox. A published phone is not "reachable" until you confirm it.
- **Retries:** 1, 3, 7, 14 and 30 days after the first attempt (configurable). Earlier retries happen on registry changes.
- **Research statuses:** Searching, Partial contacts, Verification pending, No contact found yet, Retry scheduled, Budget paused, Provider unavailable, Research exhausted.

## Hunter

| | |
|---|---|
| Docs | https://hunter.io/api-documentation/v2 |
| Endpoints used | `GET /v2/domain-search`, `GET /v2/email-verifier`, `GET /v2/domain-finder` (beta) |
| Account | hunter.io account → API key |
| Application variable | `HUNTER_API_KEY`, sent as the `X-API-KEY` header |
| Rate limits (documented) | Domain Search 15 req/s, 500/min. Email Verifier 10 req/s, 300/min. |
| Cost | Credit-based per Hunter plan. Enter your plan's cost per call in Settings → Research to track spend. |
| Safety | Hunter's documented `test-api-key` returns dummy data. The application treats it as "no key". |
| Connection test | Enable Hunter, set a budget, then run **Find contact details** on a company with a known website. Check Research ops → Provider calls. |

## Apollo

| | |
|---|---|
| Docs | https://docs.apollo.io/reference/organization-enrichment |
| Endpoint used | `GET https://api.apollo.io/api/v1/organizations/enrich?domain=…` (header `x-api-key`) |
| Application variable | `APOLLO_API_KEY` |
| Cost (documented) | 1 credit per organization. Rate limit varies by plan (documented example: 600/hour). |
| Rules | Called only with a **confirmed** domain. A response without a phone does not complete phone research. |

## Brave

| | |
|---|---|
| Docs | https://api-dashboard.search.brave.com/app/documentation/web-search/get-started |
| Endpoint used | `GET https://api.search.brave.com/res/v1/web/search` (header `X-Subscription-Token`) |
| Application variable | `BRAVE_SEARCH_API_KEY` |
| Cost | See Brave's pricing page (not verified here). Enter the per-call cost in Settings → Research. |
| Rules | Results are leads only. Each page is fetched (robots.txt respected) and must show the registration number. |

## OpenCorporates

| | |
|---|---|
| Docs | https://api.opencorporates.com/documentation/API-Reference |
| Endpoint used | `GET /v0.4/companies/search?jurisdiction_code=xx&incorporation_date=FROM:TO` |
| Application variable | `OPENCORPORATES_API_TOKEN` |
| Limits (documented default) | 50 requests/day, 200/month |
| Licence | Share-alike for open projects. **Prospecting needs a commercial licence.** |
| Rules | `created_at` (when OpenCorporates added the record) is never used as a registration date. Coverage and delay must be confirmed per jurisdiction before you select it in Settings → Countries. |

## Vainu (evaluated, not integrated)

Vainu's Organizations API (`POST https://api.vainu.io/api/v3/organizations/`) lists FI, SE, NO, DK and NL databases, with contact data among its selectable fields. It is **not** connected. Before it could be used as a registration source, the following must be checked with a real account and recent companies:
- the exact legal-registration date field;
- contact availability;
- account permissions;
- publication delay.

Until then it is only a candidate enrichment source.

## Privacy and permitted use

- Only business contact channels and professional roles are stored. National ID numbers, birth dates and private addresses are never stored.
- A published contact is not permission to market. Outreach eligibility (Needs review / Cleared / Restricted / Do not contact) is a separate human decision. It applies to drafts, exports and quotation recipients.
- **Source restrictions always win.** Danish reklamebeskyttelse and KVK non-mailing make a company Restricted. Suppression entries are honoured regardless of which provider later finds the same address.
- Deletion, objection and correction are on the company profile: delete, Do not contact plus suppression, and manual edits.
