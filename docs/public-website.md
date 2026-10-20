# Public website: structure and how to update it

Positioning: **Websites That Turn Visitors Into Customers.** The site is written for Norwegian and European small businesses: calm, concrete and transparent. No urgency, guarantees or invented proof.

## Structure

```
Google / email / outreach
   → focused service landing page (/services/<slug>)   one problem, one solution, one offer
   → examples, price and delivery, FAQ                   → "Request an Offer" (contact form, need preselected)
   → central website (/, /services, /work, /how-we-work)  other services, the long-term relationship
```

| Page | What it does |
|---|---|
| `/` | Hero ("Let's Work Together" / "Explore Services"), the problem, Build → Attract → Engage → Convert → Grow, concise service cards, the long-term partner, **build before you commit**, industries, principles, **the three ways of working**, CTA |
| `/services` | All focused services (cards), then the six original service areas as a capability overview |
| `/services/<slug>` | A focused landing page (see below). The original service-area slugs still work |
| `/work`, `/work/<slug>` | Portfolio (published case studies only) and the video walkthrough showcase |
| `/how-we-work` | Process, the three ways of working, build-first pointer |
| `/how-we-work/monthly`, `/how-we-work/task-based`, `/how-we-work/growth-partnership` | The engagement models. The growth partnership has its own dark, selective presentation and is stated not to be a payment plan. The former `/engagement/<slug>` addresses redirect here (308) |
| `/how-we-work/build-first` | "Build before you commit": Option A (build → review → approve and pay → receive) and Option B (pay → build → receive); scope, price and review rounds agreed in writing first; explicitly not free development and not a fourth payment plan |

The homepage shows no portfolio ("Our work") section for now — "Build before you commit" takes its place. `/work` still exists and lists published case studies; landing pages show their examples section only once real projects are published. Outreach emails no longer link to `/work`; the website offer mentions the build-first start instead.

### Landing pages

`/services/web-development`, `/services/web-crm`, `/services/crm`, `/services/seo`, `/services/visual-identity`, `/services/social-media`, `/services/data-collection`, `/services/recruitment`, `/services/automation`, `/services/digital-operations` (digital partner).

Each page has the same reusable sections (`src/components/site/service-landing.tsx`): hero with price and delivery facts → challenge → solution → what is included → how it works → what you receive, plus price and delivery with "not included" and "optional additions" → real examples → after delivery and the ways of working → FAQ → related services → CTA. It also emits Service, FAQPage and BreadcrumbList structured data, the canonical URL, hreflang and Open Graph.

## Service Management (dashboard)

Services are managed in **Dashboard → Clients → Service management** (Owner) or **Staff workspace → Website → Service management** (Admins by default; Staff only when the Owner grants the `services.manage` permission). Every change is published to the website immediately — no code changes.

| Task | How |
|---|---|
| Add a service | **+ Add service**. New services start **inactive**: save, use **Preview**, then activate. |
| Edit text, landing page, SEO | Open the service. Sections: Basic information, Description, Pricing, Discount, Engagement options, Landing page, SEO, Visibility, Preview. Lists are one item per line; empty sections are not shown. |
| Translations | Language tabs at the top (EN is the base text). An empty translated field uses the English text. Norwegian is already filled in for the original services. |
| Price | Model: **Fixed** ("Fixed price: 15 000 kr"), **Starting from**, **Monthly** ("5 000 kr per month") or **Custom quote**; amount and currency (NOK, EUR, …). Empty amount → the page says how the price is agreed — never an invented number. |
| Discount | Percentage or fixed amount, optional label ("Introductory offer") and start/end dates. Shown as the regular price (struck through) and the offer price; inactive outside its dates. Needs a published amount. |
| Engagement options | Task-based, Monthly service and/or Growth partnership — shown separately from the service price; the growth partnership is always presented as a selective relationship, never a payment plan. |
| Homepage | Mark services **Featured** (★). The homepage shows active featured services; `/services` shows all active ones. |
| Order | ↑ / ↓ in the list, or the display order field. |
| Hide | **Deactivate** (stays in the list) or **Delete → Move to trash** (hidden, restorable). |
| Delete permanently | Owner only, from the trash, by typing the service address. Refused while contact enquiries refer to the service — keep it deactivated instead. |

Data: collection `services` (model `src/models/Service.ts`). On first start the migration `2026-10-service-catalogue-v1` copies the ten original services from the existing website content into it (only if the collection is empty; no prices). Until then, and without a database, the site shows those same built-in services.

APIs — admin (Owner / `services.manage`): `GET|POST /api/services`, `GET|PATCH|DELETE /api/services/:id` (`DELETE ?permanent=1` + `{ confirmSlug }`, Owner only), `POST /api/services/:id/status`, `PATCH /api/services/:id/pricing|discount|landing`, `POST /api/services/:id/restore`, `POST /api/services/reorder`. Public (read-only, active services, public fields): `GET /api/public/services?locale=no`, `GET /api/public/services/:slug`.

Outreach emails (Email Sender) use the live service: price (with an active discount), delivery time and landing page. If the service is inactive, the email says the price is agreed in writing and links to the homepage. Creating or editing a service never sends anything.

## Common changes

| Change | Where |
|---|---|
| Service names, prices, discounts, landing pages | Service Management (above) |
| Shared page labels (buttons, section titles), engagement models | Settings → Languages (keys `servicePages.ui.*`, `home.engagement.*`), or `messages/<lang>.json` |
| Add a portfolio project / video | Dashboard → Services → Case studies: title, summary ("what was built"), challenge ("goal"), services, and optionally a project link, a thumbnail image and a walkthrough video (YouTube, Vimeo or a direct `.mp4`/`.webm`, https only). Mark illustrative work as an example. Published projects appear on `/work`, the homepage and every landing page whose services match. |

## Languages

English and **Norwegian Bokmål** are written in full. German, Swedish, Finnish, Danish and French currently show the English text for the new landing-page, homepage and portfolio sections until they are translated (Settings → Languages).

## Rules

- No invented clients, testimonials, results, rankings, prices or delivery times. Empty sections show a clearly marked placeholder.
- No guaranteed Google rankings; specialist work (large brand projects, specialist recruitment, photo/video production) is described as coordinated, not done in-house.
- The growth partnership is presented as a separate, selective relationship, never as a price tier.
