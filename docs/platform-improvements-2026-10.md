# Platform improvements — October 2026

_28 Oct 2026. Roles and permissions are documented in [access-control.md](access-control.md)._

## 1. Verification email deliverability

**What changed in code**

- New verification email ([`src/lib/email/deliverability.ts`](../src/lib/email/deliverability.ts)): subject `123456 is your ExploreTechify verification code`, a short personal text part, and a matching table-based HTML part with **no links, images or tracking**, a hidden preheader, and light/dark colour-scheme meta tags.
- Every transactional email now carries `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All` and a unique `X-Entity-Ref-ID` (so Gmail doesn't thread successive codes together), plus `Reply-To` when `EMAIL_REPLY_TO` is set.
- The log never stores a code: sensitive messages are saved with subject `[Security message]` and a redacted body. Each transactional email is tagged with a `category` (`VERIFICATION`, `ACCOUNT` or `NOTIFICATION`).
- Rate limits: the existing 60-second resend lock, 10-minute expiry, 5 attempts per code and per-IP route limit, plus **at most 5 codes per address per hour** (`AUTH_CODES_PER_HOUR`).
- Failures are logged as one structured line without the address (`[email] transactional delivery failed category=… provider=… outcome=… reason=…`).
- **Bounces**: the mailbox poller recognises delivery-failure reports (DSN) in the Zoho inbox, marks the message `BOUNCED`, marks a matching company email `BOUNCED` (it stops counting as a direct contact) and, for hard bounces, adds the address to the outreach suppression list. Verification codes themselves are never blocked by the suppression list.
- **Monitoring**: *Settings → Email* shows a live SPF / DKIM / DMARC check of the sending domain (with the exact record to add) and the last 7 days of transactional delivery (accepted / failed / bounced, codes failed, recent failures with masked addresses). `npm run email:check` prints the same DNS report; `npm run email:check -- --send a@gmail.com b@outlook.com` sends the real verification template (with a test code) to inboxes you control.

**DNS checked live on 28 Oct 2026 (exploretechify.com)**

| Record | Result |
|---|---|
| MX | Zoho (`mx.zoho.com`, `mx2`, `mx3`) |
| SPF | ✅ `v=spf1 include:zohomail.com ~all` |
| DKIM | ✅ key published at `zoho._domainkey` |
| DMARC | ❌ **missing** |
| Extra | ⚠️ a second DKIM key is published on the apex `exploretechify.com` TXT, where no receiver looks |

**Manual actions (need DNS / Zoho / hosting access)**

1. **Add DMARC** at your DNS host: `TXT _dmarc.exploretechify.com "v=DMARC1; p=none; rua=mailto:hello@exploretechify.com; adkim=r; aspf=r; pct=100"`. After 2–4 weeks of clean reports, change `p=none` to `p=quarantine`.
2. In **Zoho Mail Admin → Domains → exploretechify.com → DKIM**, confirm the `zoho` selector shows **Verified / signing enabled**.
3. Remove the stray `v=DKIM1…` TXT record on the apex domain (harmless, but confusing).
4. On the deployed server change `EMAIL_FROM_NAME=ExploreTechify_Team` to a plain name, e.g. `EMAIL_FROM_NAME=ExploreTechify` (underscores look automated to filters and people).
5. Optional: set `EMAIL_REPLY_TO` to a monitored address.
6. Send real test codes to Gmail, Outlook, Yahoo and a business mailbox (`npm run email:check -- --send …`), open "Show original" (Gmail) / message headers, and confirm `spf=pass dkim=pass dmarc=pass` and the folder.

No change can guarantee Primary-inbox placement: Gmail's Primary / Promotions split and spam filtering are decided by the recipient's provider, partly from engagement history. Authentication (SPF + DKIM + DMARC aligned) and a plain, link-free transactional message are the parts the platform controls.

## 2 & 5. Roles and permissions

See [access-control.md](access-control.md): new **Manager** role, **Admin** label (was “Super Admin”), service cards with an Access switch and action chips, Advanced permissions, access presets, Owner-editable **role templates** (optionally applied to everyone with the role), and Company Intelligence data access grantable per person. Owner tools stay Owner-only; clients never receive team permissions.

## 3 & 8. Digital Marketer page

`/staff/client-leads`: gradient summary header with real counts (active leads, sent in 7 days, with phone, with website), the startup / established / needs-review mix, a Company Type filter, a **Company Type** column at the end of the table (sortable), tap-to-call phone numbers, mobile cards with a coloured type stripe.

## 6. Startup / Established Company classification

One shared rule set in [`src/lib/company-classification.ts`](../src/lib/company-classification.ts), stored on `Company.companyType` and used by the Owner's Company Intelligence (category tabs, table column, filter, CSV), the team directory and the Digital Marketer table. Age is never the only signal:

- Startup: a new legal entity registered < 3 years ago, unless it already reports ≥ 50 employees.
- Established Company: an active new entity registered ≥ 5 years ago; 3–5 years old with ≥ 10 employees; or a re-registration of an existing business ≥ 5 years old.
- Needs Review: no date, inactive status, branch registrations, ambiguous events, 3–5 years with no evidence of scale, young companies with large headcounts.
- People with “Edit Company Records” can set the type manually (audited); “Automatic” returns to the rules. The scheduler re-evaluates automatic classifications weekly, so companies age into the right category.

## 7. Established companies

[`src/features/registry/established.ts`](../src/features/registry/established.ts) asks the same official registries for companies registered on past days (walking back from five years ago, two days per country per day), keeps only active companies the shared rules don't classify as startups, and stores them with `discoveredVia: ESTABLISHED_COLLECTION`; free contact research is queued as for new companies. `npm run registry:established -- --probe` checks the sources live without writing anything; `ESTABLISHED_COLLECTION=off` disables the job.

Live probe of a weekday five years ago (28 Oct 2026):

| Country | Source | Fetched | Active & established |
|---|---|---|---|
| Norway | Brønnøysund | 169 | 166 (13 email, 2 website from the registry) |
| Finland | PRH | 41 | 39 (7 website) |
| Ireland | CRO | 70 | 59 |
| United States | NY / CO / CT / OR open data | 200 of 225 | 176 |
| Australia | ASIC | 200 of 970 | 180 |

Not collected yet: Latvia, Estonia, Canada (bulk register files need a windowed streaming scan first), Poland (KRS bulletin scan is ~10 min per day), France / Switzerland / Czechia (publication feeds, not registers), and countries needing credentials (UK, Netherlands, Germany, Denmark).

## 4. Business contact coverage

**Why US and Australia lacked emails.** Neither registry publishes a website, phone or (except Connecticut filings) email, so contacts depend on finding the company's own website — and website discovery had no domain endings for US, AU, CA, PL or JP, didn't strip `Inc / LLC / Corp / Pty`, and ignored national-format phone numbers on US/AU sites. All three are fixed: discovery now tries `.com` (US), `.ca`/`.com` (CA), `.com.au`/`.au` (AU), `.pl` (PL), `.co.jp` (JP); every candidate site must still show the registration number or the exact legal name. NANP numbers (`(212) 555-0100`, `1-800-…`, `011 …`) and Australian trunk-0 numbers are normalised to E.164 and displayed with country grouping.

**Contact Status** per company: Verified, Unverified, Needs Review, Not Publicly Available (research ran and found nothing public — not proof none exists), Research pending. Filterable everywhere, included in exports. A generic inbox is labelled “Business inbox”; only an address the source publishes with a named person is labelled “Named person” — never inferred.

**What the registries themselves publish** (live `registry:verify`, latest full day, 26–27 Oct 2026):

| Country | Records | Email | Phone | Website |
|---|---|---|---|---|
| Norway | 344 | 18 | 13 (incl. mobile) | 6 |
| Finland | 106 | 0 | 0 | 2 |
| United States | 2,000 of 2,171 | 170 (Connecticut filings) | 0 | 0 |
| Canada | 152 | 0 | 0 | 0 |
| France (BODACC) | 1,131 of 1,651 | 0 | 0 | 0 |
| Switzerland | 146 | 0 | 0 | 0 |
| Czechia | 143 | 0 | 0 | 0 |
| Estonia | 143 | 0 | 0 | 0 |
| Australia | — | 0 | 0 | 0 (ASIC publishes no contacts) |

Everything else comes from the company's own website (free) or, if you enable them with a budget, Hunter / Apollo / Brave. Run `npm run coverage:contacts` against the production database for the stored per-country coverage (read-only).

**Further legitimate sources worth considering** (not connected): Belgium KBO Open Data (has phone / email / web, needs a free account), UK Companies House (free key; no contacts but adds a large market), an Australian Business Register (ABN Lookup, free GUID) for trading names, and paid enrichment you already support (Hunter, Apollo) for named decision-makers, which must remain marked as enrichment-sourced.

**Compliance.** The directory states the source of every value and withholds contacts the registry marks as marketing-protected or that are restricted / suppressed — also in exports. Outreach must follow the recipient country's rules (GDPR / ePrivacy, CAN-SPAM, CASL, the Australian Spam Act) and honour every opt-out.

## Deployment

1. Deploy as usual (`npm run build`, `npm start`). No new dependencies.
2. Migrations run automatically from the scheduler (`npm run migrate` runs them manually): `2026-10-company-type-v1` (classifies every company; adds two indexes) and `2026-10-manager-role-v1`.
3. New optional environment variables: `EMAIL_DKIM_SELECTOR` (default `zoho`), `AUTH_CODES_PER_HOUR` (default 5), `ESTABLISHED_COLLECTION` (default on), `EMAIL_REPLY_TO`.
4. Do the DNS / Zoho / env actions in section 1.
5. In *Users & access*, review the role templates, then grant Company Intelligence to the people who need it (preset “Marketer — research & outreach lists” for Digital Marketers).
