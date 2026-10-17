# Email Sender (Owner only)

`/dashboard/email-sender` — send one professional email to one recipient, either the ready-made ExploreTechify introduction (**Fixed template**) or a message you write (**Custom email**). Sidebar: **Outreach → Email Sender** (shown to the Owner only).

## How it works

| | Fixed template | Custom email |
|---|---|---|
| You enter | recipient | recipient, subject, message (and whether to add the "See How We Can Help" button) |
| Content | `src/features/email-sender/template.ts` (`DEFAULT_TEMPLATE`) | plain text with safe markup: blank line = paragraph, `## ` = heading, `- ` = bullet (`- **Title**: text` on every item = highlight cards), `A → B → C` on its own line = a flow, `**bold**`, `https://` links |
| Layout | the same branded ExploreTechify layout for both: navy header with the logo, hero with the tagline, the message, an optional "See How We Can Help" button (on in the fixed template), a signature with contact details, and a navy footer with the legal name, postal address and opt-out | |

- **Preview = what is sent.** The preview is rendered by the same server code as the send, and shown in a sandboxed iframe (no scripts).
- **HTML is never accepted** from the composer. Everything you type is escaped first; only the markup above becomes formatting. So there is no untrusted HTML to sanitize, by construction.
- **Every email is multipart:** HTML plus a readable plain-text version.
- **"Start from template"** copies the default subject and text into the composer. Editing it never changes the saved default template.
- **No placeholders** are evaluated, so nothing is personalised automatically. Write the name yourself when you know it.

## Security (Owner only, enforced on the server)

| Layer | Enforcement |
|---|---|
| Navigation | The "Email Sender" item is rendered only for the OWNER role. |
| Proxy | `/dashboard/**` is owner-only (ADMIN/STAFF are redirected to `/staff`, clients to `/portal`). |
| Page | `requireOwnerPage()`: every other role gets a 404. |
| API | `/api/email-sender/{preview,send,history}` use `route({ ownerOnly: true })`: 401 when signed out, 403 for ADMIN/STAFF/CLIENT. The role comes from the server session, never from the request body. |
| Service | Every function in `src/features/email-sender/service.ts` calls `assertOwner(actor)` first, so internal callers can't bypass it. |

## Guards on every send

1. Validation: one valid recipient; subject 3–200 characters with no line breaks; message 10–10,000 characters.
2. A live provider must be configured, and `NEXT_PUBLIC_SITE_URL` must be public `https` (the unsubscribe link). Otherwise you get a setup error and nothing is sent.
3. Suppression list (Outreach → Suppression): blocked addresses and domains are never emailed.
4. Limits: 10 requests per minute per IP, `EMAIL_SENDER_HOURLY_LIMIT` per Owner, `EMAIL_SENDER_DAILY_LIMIT` in total.
5. Cooldown: `EMAIL_SENDER_COOLDOWN_MINUTES` before the same address can be emailed again. This also applies after an "outcome unknown" failure.
6. Duplicate protection: each compose session has a request key, so a double click or a retry never sends twice.

## Status is honest

- **Accepted by provider** (`SENT`): the provider took the email for delivery. Delivery itself isn't tracked (no provider webhooks are integrated), so nothing is ever marked "delivered".
- **Failed: rejected**: the provider refused it, typically an invalid key or password, an unverified domain or sender, or a refused recipient.
- **Failed: outcome unknown**: a timeout or network error. The provider may or may not have sent it, so check its dashboard (Zoho: the Sent folder) before retrying. Nothing is retried automatically. The cooldown prevents accidental doubles.
- **History** stores recipient, mode, subject, the Owner's user id, timestamps, provider and message id, and status. It never stores message bodies. Records expire after `EMAIL_SENDER_RETENTION_DAYS`. Every send is also written to the audit log (recipient domain only).

## Activating delivery with Zoho Mail (SMTP)

The site signs in to your Zoho mailbox over SMTP (Nodemailer, server-side only) and sends as that mailbox. Set these on the server (`.env.local` locally, the host's environment settings in production), then **restart** the server:

```
EMAIL_PROVIDER=zoho-smtp
ZOHO_SMTP_HOST=<from your Zoho Mail SMTP settings>
ZOHO_SMTP_PORT=465            # or 587
ZOHO_SMTP_SECURE=true         # true with 465 (SSL); false with 587 (STARTTLS, enforced)
ZOHO_SMTP_USER=<your full Zoho mailbox address>
ZOHO_SMTP_PASSWORD=<app-specific password>
EMAIL_FROM_ADDRESS=<the mailbox above, or one of its Zoho aliases>
EMAIL_FROM_NAME=ExploreTechify Team
NEXT_PUBLIC_SITE_URL=https://exploretechify.com
```

1. **Host:** open Zoho Mail → Settings → Mail Accounts → your address → **SMTP** and copy the outgoing server shown there. It depends on your data centre and account type (e.g. `smtp.zoho.com`, `smtp.zoho.eu`, `smtp.zoho.in`; organization/domain mailboxes use `smtppro.zoho.*`). A wrong region gives an authentication failure.
2. **Port / security:** `465` + `ZOHO_SMTP_SECURE=true` (implicit SSL) or `587` + `false` (STARTTLS; the connection is refused if the server doesn't upgrade to TLS). Any other combination is reported on the page as a setup problem. TLS 1.2+ and certificate verification are always on.
3. **Password:** if two-factor authentication is on, create an **application-specific password** (Zoho Accounts → Security → App Passwords) and use that. Organization admins may also need to allow SMTP access for the user in the Zoho Mail Admin Console.
4. **From address:** Zoho only relays mail whose From is the signed-in mailbox or one of its aliases. With `zoho-smtp`, `EMAIL_FROM_ADDRESS` is used for **every** email the site sends (Email Sender, outreach, transactional) and overrides `EMAIL_SENDER_FROM` / `EMAIL_FROM`. If another feature asks for a different sender, that address becomes the Reply-To instead.
5. **DNS:** for your domain, keep Zoho's SPF include (`include:zoho.com` / `include:zoho.eu` … as shown in Zoho's domain setup) and its DKIM key, plus a DMARC record. Since mail goes through Zoho's own servers, no other provider needs adding.
6. **Limits:** Zoho caps how many emails a mailbox may send per day; keep `EMAIL_SENDER_DAILY_LIMIT` below it.
7. **Test:** send to a mailbox you own, then check the message arrived, appears in your Zoho **Sent** folder, and that its headers show SPF/DKIM/DMARC pass.

The page shows exactly which of these settings is missing or inconsistent (names only — values and the password are never shown, logged or returned by the API), and the Send button stays disabled until they're complete.

How Zoho outcomes are recorded:

| SMTP result | Status | Retry? |
|---|---|---|
| Server accepted the message (250) | Accepted by provider | — |
| Sign-in refused (`EAUTH`, 535) | Failed: rejected (sign-in failed) | Fix credentials, then send again |
| Sender refused at `MAIL FROM` | Failed: rejected (sender refused) | Fix `EMAIL_FROM_ADDRESS` |
| Recipient refused at `RCPT TO` | Failed: rejected (recipient refused) | Check the address |
| Message refused after `DATA` | Failed: rejected (message refused) | Later, or check Zoho limits |
| Timeout, dropped connection, other network error | Failed: outcome unknown | **Never automatic.** Check Zoho's Sent folder; the cooldown blocks re-sending to that address |

## Activating delivery with Resend or SendGrid

1. **Choose a provider.** Resend or SendGrid are also supported (`src/lib/email/provider.ts`). Set:
   ```
   EMAIL_PROVIDER=resend            # or sendgrid
   EMAIL_API_KEY=<provider API key> # server-side only, never exposed to the browser
   EMAIL_SENDER_FROM=hello@exploretechify.com
   NEXT_PUBLIC_SITE_URL=https://exploretechify.com
   ```
2. **Verify the domain** `exploretechify.com` with the provider. Add the DNS records it gives you:
   - **SPF:** one TXT record on the domain. Include the provider (e.g. Resend uses a `send` subdomain with `include:amazonses.com`; SendGrid uses `include:sendgrid.net`). Keep a single SPF record. If Google Workspace already handles `hello@`, merge the includes, e.g. `v=spf1 include:_spf.google.com include:sendgrid.net ~all`.
   - **DKIM:** the CNAME/TXT keys the provider gives you.
   - **DMARC:** start with `_dmarc.exploretechify.com TXT "v=DMARC1; p=none; rua=mailto:hello@exploretechify.com"`, then move to `p=quarantine` once reports show SPF/DKIM passing.
3. **Verify the sender identity** `hello@exploretechify.com` (SendGrid: Sender Authentication; Resend: verified domain). The From address is never chosen by the browser, and the app does not fall back to a different sender.
4. **Check sending limits.** New accounts are often limited (sandbox or test mode, daily caps) until the provider reviews them.
5. **Test** by sending to your own mailbox and checking SPF/DKIM/DMARC pass in the message headers.

Replies: with Zoho they go to the sending mailbox (`EMAIL_FROM_ADDRESS`) unless `EMAIL_REPLY_TO` names another monitored address; no Reply-To header is added when it would equal From. With Resend/SendGrid they go to `hello@exploretechify.com` unless `EMAIL_REPLY_TO` is set.

## Deliverability and inbox placement

No code can guarantee the Primary tab: Gmail, Outlook and others classify mail with their own models, using content, sender reputation, recipient engagement and history. The app's job is to send an honest, ordinary-looking, properly authenticated email; the rest is outside its control.

**What the email looks like (template `default-v6`).** It uses the same visual language as the homepage: night navy (`#0e1630`), electric blue (`#2849dc` button, `#2139b5` links), one cyan signal accent, white. Subject: "A website built to turn visitors into customers". Layout: a header with the ExploreTechify logo mark and domain; a compact hero with "Business Websites & Digital Growth" and the tagline "Websites That Turn Visitors Into Customers."; the message: two short paragraphs, a Website → Visitors → Enquiries → Customers flow drawn as pills, "What we focus on" as four cards (Attract, Engage, Convert, Grow), "Beyond the website" as one sentence of supporting services, a paragraph on the long-term relationship that mentions the ways of working (monthly, defined project, growth partnership for suitable businesses; no prices, shares or terms), and a reply invitation; one "See How We Can Help" button to the website; a signature with contact details; and a navy footer with the name, tagline, website, hello@exploretechify.com, © legal name, optional postal address and the opt-out line ("simply reply and let us know, or unsubscribe here"). It makes no promises of results. The headings, cards and flow use the composer's markup (`## Heading`; bullet items that all read `**Title**: text`; `A → B → C` on its own line), so "Start from template" in Custom mode reproduces the same layout.

How it is built so it renders reliably:
- Tables with `role="presentation"` and inline CSS; a fixed 600px Outlook wrapper via `<!--[if mso]>` conditional comments; fluid `max-width:600px` elsewhere.
- **No images at all.** The logo mark, the accent rule, the flow pills, the cards and the button are drawn with coloured table cells, so the email looks complete when images are blocked and depends on no hosted asset. (The site's logo is an inline SVG, which Gmail doesn't render.)
- About 16 KB of HTML (Gmail clips at ~102 KB).
- System fonts only (Segoe UI/Helvetica/Arial, matching the site's sans-serif type). No web fonts, external stylesheets or JavaScript.
- One `<style>` block, used only to tighten spacing on phones, stack the focus cards under 520px and the header under 420px. Without it (some clients strip it), the layout is still fluid and readable.
- No hidden preheader or hidden text, no tracking pixel, no link shorteners; every link points to the website, the reply address or the opt-out page.
- The plain-text part carries the same message: brand line and tagline, body, the website link, the signature with contact details, and the opt-out.

Trade-off: a banner, hero and button are typical of marketing mail, so Gmail is more likely to place this email in Promotions than a plain one. No design guarantees Primary placement either way.

**Headers.** From = your Zoho mailbox (or alias) with a consistent From name; Reply-To = a monitored mailbox; `Message-ID` (`<random@your-domain>`) and `Date` are generated by Nodemailer; Zoho adds its DKIM signature. The only extra headers are `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 2369/8058 one-click opt-out). No `Precedence`, `X-Priority`, fake `Re:`/`Fwd:` or other classification tricks are ever added.

> **Trade-off you may decide on:** `List-Unsubscribe` is the standard opt-out signal for mailing lists, and Gmail shows an "Unsubscribe" link at the top when it is present, which can make a one-to-one email look like list mail. It is kept because it gives recipients a reliable one-click opt-out that goes straight into the suppression list. The in-body unsubscribe link and "reply to opt out" remain either way.

**Sender settings that help.**
- `EMAIL_FROM_NAME`: use a real person's name (e.g. `Jane Doe` or `Jane Doe | ExploreTechify`), spelled normally (no underscores), and keep it constant. It's also the signature. A machine-looking name like `ExploreTechify_Team` shows in the inbox list and in "Best regards," and reads as automated mail. If the value has spaces, quote it in the env file (`EMAIL_FROM_NAME="Jane Doe"`).
- `EMAIL_SENDER_POSTAL_ADDRESS`: your business postal address. US CAN-SPAM requires one in commercial email; it also adds legitimacy.
- Send from a mailbox you actually use and answer replies from it. Replies and ongoing conversations are the strongest positive signal.
- Start slowly: a handful of well-targeted emails a day, to people who plausibly want to hear from you. Bounces, spam complaints and ignored mail all hurt reputation. Keep `EMAIL_SENDER_DAILY_LIMIT` low.
- Custom emails: write them individually. Mention why you're contacting this specific business, keep to one question or request, avoid sales slogans, exclamation marks and ALL-CAPS, and use at most one or two links.

**Domain authentication (Zoho).** Check each record in Zoho Mail Admin Console → Domains → your domain → Email Configuration, which shows the exact values for your account and whether each one verifies. Don't copy values from elsewhere.
- **SPF:** exactly one TXT record on the domain that starts with `v=spf1` and includes the Zoho include shown in the Admin Console (e.g. `include:zohomail.com`). Merge any other senders into that one record.
- **DKIM:** a TXT record at `<selector>._domainkey.<domain>` with the key Zoho generated, and DKIM *enabled* for the domain in the Admin Console. A DKIM key published at the bare domain does nothing; it must be under the selector name.
- **DMARC:** a TXT record at `_dmarc.<domain>`. Start with `v=DMARC1; p=none; rua=mailto:<a mailbox you read>` to collect reports; after a few weeks of SPF/DKIM passing, move to `p=quarantine`, then optionally `p=reject`. DMARC passes when the DKIM `d=` domain (or SPF domain) matches the From domain, which is the case when you send from your own domain through Zoho.
- Check from a terminal: `nslookup -type=TXT <domain>`, `nslookup -type=TXT _dmarc.<domain>`, `nslookup -type=TXT <selector>._domainkey.<domain>`.

**Controlled tests with Gmail.**
1. Send the template to a personal Gmail address you own, and a custom email to a second one. Don't send the same test repeatedly to many addresses.
2. In Gmail open the message → **⋮ → Show original**. The summary at the top shows `SPF`, `DKIM` and `DMARC` with PASS/FAIL, and the `Message-ID`. In the raw headers, `Authentication-Results` should show `dkim=pass header.d=<your domain>`, `spf=pass` and `dmarc=pass`.
3. Note which tab it landed in. A first email from a new sender often lands in Promotions or Updates even when everything is correct. Replying from the Gmail account, or moving it to Primary, teaches Gmail for that recipient only.
4. Optional checks: mail-tester.com (send to the one-off address it gives you; scores authentication and content), and **Google Postmaster Tools** (postmaster.google.com: verify your domain to see spam rate, domain reputation and authentication. Data only appears once you send a meaningful volume to Gmail users).

## Unsubscribe / opt-out process

- **Link (automatic):** every email has a signed unsubscribe link and a one-click `List-Unsubscribe` header. Using either adds the address to the suppression list immediately.
- **Reply "Unsubscribe" (manual):** these replies arrive at `hello@exploretechify.com`. Add the address under **Outreach → Suppression** (reason: Opt-out) promptly. The Email Sender then refuses to email it again.

## Limitations

- One recipient per send. No bulk mailing or campaigns here; that's the reviewed Outreach workflow.
- Delivery, bounce and open events aren't tracked, since no provider webhooks are integrated.
- In-memory rate limits apply per server instance. On multi-instance hosting, the daily limit and cooldown, which are database-backed, remain global.
