import { siteConfig } from "@/config/site";
import { escapeHtml } from "@/lib/email/render";

/**
 * Email Sender — templates and rendering (pure, no I/O).
 *
 * Content model: the Owner writes PLAIN TEXT with a tiny, safe markup — never HTML:
 *   blank line      → new paragraph
 *   "## Heading"    → section heading (on its own line)
 *   "- item"        → bullet list
 *   "- **Title**: text" on every item → a compact two-column highlight grid
 *   **bold**        → bold
 *   http(s)://…     → link (http/https only)
 * Everything is HTML-escaped before markup is applied, so user input can never inject
 * tags, attributes, styles or scripts. The same renderer produces the preview and the sent
 * email, plus a readable plain-text alternative.
 */

export const PUBLIC_SITE_URL = `https://${siteConfig.domain}/`;
export const BUSINESS_EMAIL = siteConfig.contact.email;

export const LIMITS = { subject: 200, body: 10_000 } as const;

/**
 * The website's palette: night navy foundation, electric blue accent, one cyan signal.
 * Text colours meet WCAG AA on their backgrounds (body #1f2937 and links #2139b5 on
 * white, white on the #2849dc button, footer #a9b6c8 on #080d1f).
 */
const C = {
  canvas: "#e9eef4",
  navy: "#0e1630", // night-900
  navyDeep: "#080d1f", // night-950
  navySoft: "#1d2a52",
  accent: "#3d66f0", // brand-500
  accentStrong: "#2849dc", // brand-600: the button
  accentText: "#2139b5", // brand-700: links and headings on white
  accentTint: "#eef3ff", // brand-50
  accentLine: "#dce6ff", // brand-100
  logoDot: "#6189f8", // brand-400, as in the site's logo mark
  signal: "#3fd0e6", // signal-400
  signalPale: "#7fe3f2", // signal-300
  white: "#ffffff",
  text: "#1f2937",
  muted: "#64748b",
  hairline: "#e2e8f0",
  footerText: "#a9b6c8",
} as const;

const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";

const STYLE = {
  p: `margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.text}`,
  ul: `margin:0 0 18px;padding-left:22px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.text}`,
  li: "margin:0 0 6px",
  h2: `margin:30px 0 14px;font-family:${SANS};font-size:13px;line-height:18px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.accentText}`,
  link: `color:${C.accentText};text-decoration:underline`,
};

/**
 * The homepage positioning ("Websites That Turn Visitors Into Customers") as a one-to-one
 * introduction: the idea, the Website → Customers flow, four focus areas, supporting
 * services that exist on the website, the long-term relationship and the ways of working
 * (no prices or terms), and one button. Says nothing about the recipient, since nothing
 * about them is known. No promises of results.
 */
export const DEFAULT_TEMPLATE = {
  id: "default-v7",
  subject: "A website built to turn visitors into customers",
  body: [
    "Hello,",
    "Your website is often the first interaction a potential customer has with your business. But a website should do more than simply exist online.",
    `At ${siteConfig.name}, we build websites designed around a business goal: **to attract the right visitors, build trust, generate enquiries and help turn those visitors into customers.**`,
    "Website → Visitors → Enquiries → Customers",
    "## What we focus on",
    [
      "- **Attract**: Help the right people discover your business.",
      "- **Engage**: Build trust through a clear and professional digital experience.",
      "- **Convert**: Guide visitors toward enquiries, calls, bookings, purchases or other meaningful actions.",
      "- **Grow**: Keep improving the digital presence as the business develops.",
    ].join("\n"),
    "## Beyond the website",
    "Depending on what the business needs, we can also support areas such as SEO and digital visibility, social media, automation, CRM and operational systems, and ongoing technical support.",
    "We don't necessarily disappear after the website goes live. For businesses that need it, we're open to ongoing collaboration: on a monthly basis, for a clearly defined project, or, for suitable businesses, as a longer-term growth partnership.",
    "For website projects, we can build an agreed first version for you to review before you commit.",
    "If this sounds relevant, just reply to this email. We'd be glad to hear about your business.",
  ].join("\n\n"),
  includeCta: true,
  /** The single button, linking to our own website. */
  cta: { label: "See How We Can Help", url: PUBLIC_SITE_URL },
} as const;

export const EMAIL_LOCALES = ["en", "no"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export type EmailContent = {
  subject: string;
  /** Plain text with the safe markup described above. */
  body: string;
  /** Adds the single button linking to our own website. */
  includeCta?: boolean;
  /** Button label and target (our own site only); defaults to the "See How We Can Help" homepage button. */
  cta?: { label: string; url: string };
  /** Language of the surrounding layout: signature, labels, tagline and opt-out. Default English. */
  locale?: EmailLocale;
};

/** Layout text per language. Norwegian is written as Norwegian business email, not translated word for word. */
const LAYOUT: Record<EmailLocale, { lang: string; regards: string; web: string; email: string; phone: string; optOut: string; unsubscribe: string; tagline: string; positioning: string }> = {
  en: {
    lang: "en",
    regards: "Best regards,",
    web: "Web",
    email: "Email",
    phone: "Phone",
    optOut: "If you'd prefer not to receive further messages from us, simply reply and let us know, or",
    unsubscribe: "unsubscribe here",
    tagline: siteConfig.tagline,
    positioning: siteConfig.positioning,
  },
  no: {
    lang: "nb",
    regards: "Med vennlig hilsen",
    web: "Nett",
    email: "E-post",
    phone: "Telefon",
    optOut: "Ønsker du ikke flere e-poster fra oss, kan du svare og si fra, eller",
    unsubscribe: "melde deg av her",
    tagline: "Nettsider som gjør besøkende til kunder.",
    positioning: "Bedriftsnettsider og digital vekst",
  },
};

/** Only links to our own website may be used as the button target. */
function safeCta(cta: EmailContent["cta"]) {
  if (!cta) return DEFAULT_TEMPLATE.cta;
  try {
    const u = new URL(cta.url);
    if (u.protocol === "https:" && (u.hostname === siteConfig.domain || u.hostname === `www.${siteConfig.domain}`)) return { label: cta.label.slice(0, 60), url: u.toString() };
  } catch {
    /* fall through */
  }
  return DEFAULT_TEMPLATE.cta;
}

/**
 * Who signs the email: the From name, the monitored reply address, and optional phone
 * and postal address (legal footer). All come from server configuration, never the browser.
 */
export type Signature = { name: string; email?: string; phone?: string; postalAddress?: string };

export type RenderedEmail = { subject: string; html: string; text: string };

/* ───────────── Markup → HTML / text ───────────── */

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;

function inlineHtml(escaped: string) {
  // Input is already HTML-escaped; only our own tags are added here.
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, `<strong style="color:${C.navy}">$1</strong>`)
    .replace(URL_RE, (url) => `<a href="${url}" style="${STYLE.link}">${url}</a>`);
}

function inlineText(s: string) {
  return s.replace(/\*\*([^*\n]+)\*\*/g, "$1");
}

type Highlight = { title: string; text: string };
type Block = { kind: "p"; lines: string[] } | { kind: "h"; text: string } | { kind: "flow"; stages: string[] } | { kind: "ul"; items: string[] } | { kind: "grid"; items: Highlight[] };

const HIGHLIGHT_RE = /^\*\*([^*\n]+)\*\*:\s*(.+)$/;

/** "Website → Visitors → Customers" on its own line: 3–6 short stages, no links or markup. */
function flowStages(line: string) {
  const stages = line.split(/\s+(?:→|->)\s+/).map((x) => x.trim());
  return stages.length >= 3 && stages.length <= 6 && stages.every((x) => x.length > 0 && x.length <= 28 && !/https?:|\*\*/.test(x)) ? stages : null;
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").trim().split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    if (lines.length === 1 && /^\s*##\s+\S/.test(lines[0]!)) blocks.push({ kind: "h", text: lines[0]!.replace(/^\s*##\s+/, "") });
    else if (lines.length === 1 && flowStages(lines[0]!)) blocks.push({ kind: "flow", stages: flowStages(lines[0]!)! });
    else if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^\s*[-•]\s+/, ""));
      const highlights = items.map((i) => HIGHLIGHT_RE.exec(i));
      if (highlights.every(Boolean)) blocks.push({ kind: "grid", items: highlights.map((m) => ({ title: m![1]!.trim(), text: m![2]!.trim() })) });
      else blocks.push({ kind: "ul", items });
    } else blocks.push({ kind: "p", lines });
  }
  return blocks;
}

/** Two cards per row; each cell stacks to full width on phones. */
function highlightGrid(items: Highlight[]) {
  const card = (h: Highlight, side: "l" | "r") => `<td class="et-col" width="50%" valign="top" style="width:50%;padding:${side === "l" ? "0 6px 12px 0" : "0 0 12px 6px"}">
<table ${PRESENTATION} width="100%"><tr><td bgcolor="#f5f7fe" style="background-color:#f5f7fe;border-left:3px solid ${C.accent};border-radius:6px;padding:14px 16px">
<p style="margin:0 0 4px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;color:${C.navy}">${inlineHtml(escapeHtml(h.title))}</p>
<p style="margin:0;font-family:${SANS};font-size:14px;line-height:21px;color:${C.text}">${inlineHtml(escapeHtml(h.text))}</p>
</td></tr></table></td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(`<tr>${card(items[i]!, "l")}${items[i + 1] ? card(items[i + 1]!, "r") : `<td class="et-col" width="50%" style="width:50%">&nbsp;</td>`}</tr>`);
  return `<table ${PRESENTATION} width="100%" style="margin:0 0 6px">${rows.join("")}</table>`;
}

/** The stages as pills joined by arrows; inline-blocks wrap naturally on narrow screens. */
function flowPills(stages: string[]) {
  const pill = (text: string, last: boolean) =>
    `<span style="display:inline-block;margin:0 0 8px;padding:7px 14px;border-radius:999px;font-family:${SANS};font-size:14px;line-height:18px;font-weight:600;${last ? `background-color:${C.navy};color:${C.white};border:1px solid ${C.navy}` : `background-color:${C.accentTint};color:${C.navy};border:1px solid ${C.accentLine}`}">${escapeHtml(text)}</span>`;
  const arrow = `<span style="display:inline-block;margin:0 8px 8px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:700;color:${C.accent}" aria-hidden="true">&rarr;</span>`;
  return `<p style="margin:2px 0 14px">${stages.map((x, i) => pill(x, i === stages.length - 1)).join(arrow)}</p>`;
}

function bodyHtml(body: string) {
  return parseBlocks(body)
    .map((b) => {
      if (b.kind === "p") return `<p style="${STYLE.p}">${b.lines.map((l) => inlineHtml(escapeHtml(l))).join("<br>")}</p>`;
      if (b.kind === "h") return `<h2 style="${STYLE.h2}">${inlineHtml(escapeHtml(b.text))}</h2>`;
      if (b.kind === "grid") return highlightGrid(b.items);
      if (b.kind === "flow") return flowPills(b.stages);
      return `<ul style="${STYLE.ul}">${b.items.map((i) => `<li style="${STYLE.li}">${inlineHtml(escapeHtml(i))}</li>`).join("")}</ul>`;
    })
    .join("\n");
}

function bodyText(body: string) {
  return parseBlocks(body)
    .map((b) => {
      if (b.kind === "p") return b.lines.map(inlineText).join("\n");
      if (b.kind === "h") return inlineText(b.text).toUpperCase();
      if (b.kind === "grid") return b.items.map((h) => `• ${inlineText(h.title)}: ${inlineText(h.text)}`).join("\n");
      if (b.kind === "flow") return b.stages.join(" → ");
      return b.items.map((i) => `• ${inlineText(i)}`).join("\n");
    })
    .join("\n\n");
}

/* ───────────── Design pieces (tables + inline CSS; no images) ───────────── */

const PRESENTATION = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** A solid block of colour that Outlook, Gmail and Apple Mail all draw the same way. */
function cell(width: number, height: number, color: string, extra = "") {
  return `<td width="${width}" height="${height}" bgcolor="${color}" style="width:${width}px;height:${height}px;background-color:${color};font-size:0;line-height:0;mso-line-height-rule:exactly;${extra}">&nbsp;</td>`;
}

/** The site's logo mark (rounded square, three bars, a dot), rebuilt from table cells. */
function logoMark() {
  const bar = (w: number) => `<table ${PRESENTATION}><tr>${cell(w, 3, C.navy, "border-radius:2px")}</tr></table>`;
  const gap = `<table ${PRESENTATION}><tr>${cell(1, 3, C.white)}</tr></table>`;
  return `<table ${PRESENTATION} aria-hidden="true"><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="${C.white}" style="width:36px;height:36px;background-color:${C.white};border-radius:9px">
<table ${PRESENTATION}><tr>
<td valign="middle" style="padding-right:4px">${bar(14)}${gap}${bar(10)}${gap}${bar(14)}</td>
<td valign="middle"><table ${PRESENTATION}><tr>${cell(7, 7, C.logoDot, "border-radius:4px")}</tr></table></td>
</tr></table>
</td></tr></table>`;
}

/** Bulletproof button: the padded cell is the button, so Outlook draws it too. */
function button(label: string, url: string) {
  return `<table ${PRESENTATION} style="margin:6px 0 30px"><tr>
<td bgcolor="${C.accentStrong}" style="background-color:${C.accentStrong};border-radius:8px;padding:14px 26px">
<a href="${escapeHtml(url)}" style="font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;color:${C.white};text-decoration:none">${escapeHtml(label)}&nbsp;&rarr;</a>
</td></tr></table>`;
}

function contactRow(label: string, valueHtml: string) {
  return `<tr><td style="padding:3px 12px 3px 0;font-family:${SANS};font-size:11px;line-height:18px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.accentText};white-space:nowrap">${label}</td><td style="padding:3px 0;font-family:${SANS};font-size:14px;line-height:18px;color:${C.text}">${valueHtml}</td></tr>`;
}

/* ───────────── Layout ───────────── */

/**
 * Branded layout: navy header with the logo, a compact hero with the real tagline,
 * the message (paragraphs, section headings, lists, highlight cards), an optional single button, a signature with contact details and a navy
 * footer with the legal name, optional postal address and the opt-out line.
 * Tables and inline CSS only (plus one media query that tightens spacing on phones);
 * no scripts, images, web fonts, hidden text or tracking. Every element is drawn in
 * HTML, so nothing is missing when images are blocked.
 * The plain-text part carries the same message, signature and opt-out.
 */
export function renderEmail(content: EmailContent, opts: { unsubscribeUrl: string; signature: Signature }): RenderedEmail {
  const subject = content.subject.trim();
  const cta = content.includeCta ? safeCta(content.cta) : null;
  const L = LAYOUT[content.locale ?? "en"] ?? LAYOUT.en;
  const sig = opts.signature;
  const name = sig.name.trim() || `${siteConfig.name} Team`;
  const email = sig.email?.trim();
  const phone = sig.phone?.trim();
  const postal = sig.postalAddress?.trim();
  const optOut = L.optOut;
  const company = `${siteConfig.name} · ${L.positioning}`;
  const legal = `© ${new Date().getFullYear()} ${siteConfig.legalName}`;

  const contacts = [
    contactRow(L.web, `<a href="${PUBLIC_SITE_URL}" style="${STYLE.link}">${escapeHtml(siteConfig.domain)}</a>`),
    email ? contactRow(L.email, `<a href="mailto:${escapeHtml(email)}" style="${STYLE.link}">${escapeHtml(email)}</a>`) : "",
    phone ? contactRow(L.phone, escapeHtml(phone)) : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="${L.lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
@media only screen and (max-width:620px){
.et-pad{padding-left:24px!important;padding-right:24px!important}
.et-hero{padding-top:28px!important;padding-bottom:28px!important}
.et-h1{font-size:26px!important;line-height:34px!important}
}
@media only screen and (max-width:420px){
.et-stack{display:block!important;width:100%!important;text-align:left!important}
.et-stack-gap{padding-top:10px!important}
}
@media only screen and (max-width:520px){
.et-col{display:block!important;width:100%!important;padding:0 0 12px 0!important}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas}">
<table ${PRESENTATION} width="100%" bgcolor="${C.canvas}" style="background-color:${C.canvas}">
<tr><td align="center" style="padding:32px 12px">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
<table ${PRESENTATION} width="100%" style="max-width:600px;background-color:${C.white};border-radius:14px">

<tr><td class="et-pad" bgcolor="${C.navy}" style="background-color:${C.navy};padding:22px 40px;border-radius:14px 14px 0 0;border-bottom:1px solid ${C.navySoft}">
<table ${PRESENTATION} width="100%"><tr>
<td class="et-stack" valign="middle"><table ${PRESENTATION}><tr><td width="36" valign="middle" style="width:36px">${logoMark()}</td><td valign="middle" style="padding-left:12px;font-family:${SANS};font-size:19px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${C.white}">${escapeHtml(siteConfig.name)}</td></tr></table></td>
<td class="et-stack et-stack-gap" align="right" valign="middle" style="font-family:${SANS};font-size:13px;line-height:18px;color:${C.signalPale}"><a href="${PUBLIC_SITE_URL}" style="color:${C.signalPale};text-decoration:none">${escapeHtml(siteConfig.domain)}</a></td>
</tr></table>
</td></tr>

<tr><td class="et-pad et-hero" bgcolor="${C.navy}" style="background-color:${C.navy};background-image:linear-gradient(135deg,${C.navy} 0%,#14224a 60%,#1b3170 100%);padding:36px 40px 34px">
<p style="margin:0 0 14px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.signalPale}">${escapeHtml(L.positioning)}</p>
<h1 class="et-h1" style="margin:0;font-family:${SANS};font-size:30px;line-height:38px;font-weight:700;letter-spacing:-0.5px;color:${C.white}">${escapeHtml(L.tagline)}</h1>
<table ${PRESENTATION} style="margin:20px 0 0"><tr>${cell(56, 3, C.signal, "border-radius:2px")}</tr></table>
</td></tr>

<tr><td class="et-pad" style="padding:40px 40px 8px">
${bodyHtml(content.body)}
${cta ? button(cta.label, cta.url) : ""}
<table ${PRESENTATION} width="100%"><tr>${cell(1, 1, C.hairline)}</tr></table>
<table ${PRESENTATION} style="margin:26px 0 36px"><tr>
<td width="3" bgcolor="${C.accent}" style="width:3px;background-color:${C.accent};font-size:0;line-height:0">&nbsp;</td>
<td style="padding-left:18px">
<p style="margin:0 0 4px;font-family:${SANS};font-size:15px;line-height:22px;color:${C.muted}">${escapeHtml(L.regards)}</p>
<p style="margin:0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:700;color:${C.navy}">${escapeHtml(name)}</p>
<p style="margin:0 0 12px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${escapeHtml(company)}</p>
<table ${PRESENTATION}>${contacts}</table>
</td></tr></table>
</td></tr>

<tr><td class="et-pad" bgcolor="${C.navyDeep}" style="background-color:${C.navyDeep};padding:30px 40px;border-radius:0 0 14px 14px">
<p style="margin:0 0 4px;font-family:${SANS};font-size:15px;line-height:22px;font-weight:700;color:${C.white}">${escapeHtml(siteConfig.name)}</p>
<p style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.signalPale}">${escapeHtml(L.tagline)}</p>
<p style="margin:0 0 18px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.footerText}"><a href="${PUBLIC_SITE_URL}" style="color:${C.white};text-decoration:none">${escapeHtml(siteConfig.domain)}</a> &nbsp;·&nbsp; <a href="mailto:${escapeHtml(BUSINESS_EMAIL)}" style="color:${C.white};text-decoration:none">${escapeHtml(BUSINESS_EMAIL)}</a></p>
<table ${PRESENTATION} width="100%"><tr>${cell(1, 1, C.navySoft)}</tr></table>
<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:19px;color:${C.footerText}">${escapeHtml(legal)}${postal ? ` · ${escapeHtml(postal)}` : ""}<br>
${escapeHtml(optOut)} <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${C.signalPale};text-decoration:underline">${escapeHtml(L.unsubscribe)}</a>.</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${siteConfig.name} — ${L.positioning}\n${L.tagline}`,
    bodyText(content.body),
    cta ? `${cta.label}: ${cta.url}` : "",
    [L.regards, name, company, `${L.web}: ${siteConfig.domain}`, email && `${L.email}: ${email}`, phone && `${L.phone}: ${phone}`].filter(Boolean).join("\n"),
    `--\n${siteConfig.name}\n${L.tagline}\n${PUBLIC_SITE_URL}\n${BUSINESS_EMAIL}\n\n${legal}${postal ? `\n${postal}` : ""}\n${optOut} ${L.unsubscribe}: ${opts.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}

/** The ready-made introduction email (Fixed Template mode). */
export function defaultTemplateContent(): EmailContent {
  return { subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, includeCta: DEFAULT_TEMPLATE.includeCta };
}
