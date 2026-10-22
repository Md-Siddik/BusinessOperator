import { siteConfig } from "@/config/site";
import { DEFAULT_TEMPLATE, type EmailContent, type EmailLocale } from "./template";

/**
 * Outreach templates for the Owner-only Email Sender (pure, no I/O).
 *
 * One short first email per situation, in English and Norwegian Bokmål:
 *   general      — introduction when nothing is known about the recipient
 *   no-website   — website offer (presentation site + Google setup + mobile + contact path)
 *   has-website  — improvement / visibility / conversion offer
 *   recruitment  — the company appears to be hiring
 *   operations   — CRM / automation / ongoing digital operations
 *   reminder     — ONE polite follow-up after the first email, then we stop
 *
 * Rules: short, concrete, no urgency or guarantees, no service catalogue in the first email.
 * Observations are only stated when the data supports them (e.g. "no website found" only
 * after website research actually ran). Prices and delivery times appear only when they are
 * approved in src/config/service-pages.ts — otherwise the email says they are agreed in writing.
 */

export const OUTREACH_TEMPLATE_IDS = ["general", "no-website", "has-website", "recruitment", "operations", "reminder"] as const;
export type OutreachTemplateId = (typeof OUTREACH_TEMPLATE_IDS)[number];

export const OUTREACH_TEMPLATE_LABELS: Record<OutreachTemplateId, string> = {
  general: "General introduction",
  "no-website": "No website — website offer",
  "has-website": "Has website — visibility & enquiries",
  recruitment: "Hiring — recruitment support",
  operations: "Operations — CRM & automation",
  reminder: "One polite reminder",
};

/** The service each situation email offers (its landing page, price and discount come from Service Management). */
export const OUTREACH_SERVICE: Partial<Record<OutreachTemplateId, string>> = { "no-website": "web-development", "has-website": "seo", recruitment: "recruitment", operations: "web-crm" };

/**
 * Live offer details from Service Management, in the email's language. Without it (or for an
 * inactive service) the email states that the price is agreed in writing and links to the homepage.
 */
export type OutreachOffer = { name: string; priceText: string; deliveryText?: string; url: string };

/** What the email may say about the recipient. Every field is optional. */
export type OutreachContext = {
  offer?: OutreachOffer;
  companyName?: string;
  contactName?: string;
  city?: string;
  website?: string;
  /** Registered within the last ~60 days (from the registry). */
  newlyRegistered?: boolean;
  /** Website research has run at least once (so "no website found" is a real observation). */
  websiteResearched?: boolean;
  /** Website audit observations, only when an audit ran. */
  audit?: { https?: boolean | null; mobileFriendly?: boolean | null } | null;
};

const VERSION = "v1";

/** Values from data go into plain-text markup: strip markup characters, line breaks and length. */
function clean(value: string | undefined | null, max = 80) {
  const v = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\*\*|##|→|->/g, "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : undefined;
}

const siteRoot = `https://${siteConfig.domain}`;
const pageUrl = (locale: EmailLocale, path: string) => `${siteRoot}${locale === "no" ? "/no" : ""}${path}`;

/** The live price from Service Management, or — without one — how the price is agreed. Never an invented number. */
function priceLine(ctx: OutreachContext, locale: EmailLocale) {
  if (ctx.offer?.priceText) return ctx.offer.priceText.replace(/\.$/, "");
  return locale === "no" ? "Fast pris, avtalt skriftlig før vi starter" : "A fixed price, agreed in writing before we start";
}

function deliveryLine(ctx: OutreachContext, locale: EmailLocale) {
  if (ctx.offer?.deliveryText) return (locale === "no" ? `Levering: ${ctx.offer.deliveryText}` : `Delivery: ${ctx.offer.deliveryText}`).replace(/\.$/, "");
  return locale === "no" ? "Tidsplanen avtales i tilbudet" : "Timeline agreed in the offer";
}

/** The landing page when the service is live, otherwise our homepage. */
const offerUrl = (ctx: OutreachContext, locale: EmailLocale) => ctx.offer?.url ?? pageUrl(locale, "/");

const greeting = (locale: EmailLocale, ctx: OutreachContext) => {
  const name = clean(ctx.contactName, 60);
  return locale === "no" ? `Hei${name ? ` ${name}` : ""},` : `Hello${name ? ` ${name}` : ""},`;
};

const closing = (locale: EmailLocale) =>
  locale === "no" ? "Er dette relevant, kan du bare svare på denne e-posten. Da tar vi gjerne en kort og uforpliktende prat." : "If this is relevant, simply reply to this email and we can have a short, no-obligation conversation.";

/** No portfolio link for now (no published client projects yet): website emails offer the build-first start instead. */
const buildFirstLine = (locale: EmailLocale) =>
  locale === "no" ? "Vil du se resultatet før du bestemmer deg, kan vi bygge en avtalt første versjon som du vurderer før du forplikter deg." : "If you would like to see the result before deciding, we can build an agreed first version for you to review before you commit.";

type Built = { subject: string; body: string; cta?: { label: string; url: string } };

const BUILDERS: Record<OutreachTemplateId, (locale: EmailLocale, ctx: OutreachContext) => Built> = {
  general: (locale) =>
    locale === "no"
      ? {
          subject: "En nettside som gjør besøkende til kunder",
          body: [
            "Hei,",
            "Nettsiden er ofte det første møtet en kunde har med bedriften din. Den bør gjøre mer enn å bare finnes.",
            `I ${siteConfig.name} bygger vi nettsider med ett mål: **å tiltrekke de riktige besøkende, bygge tillit og gjøre det enkelt å ta kontakt.**`,
            "Nettside → Besøkende → Henvendelser → Kunder",
            "## Dette jobber vi med",
            [
              "- **Bli funnet**: Hjelpe de riktige kundene å finne bedriften.",
              "- **Bygge tillit**: En tydelig og profesjonell digital opplevelse.",
              "- **Få henvendelser**: Enkle veier til forespørsel, samtale eller bestilling.",
              "- **Vokse videre**: Løpende forbedringer etter hvert som bedriften utvikler seg.",
            ].join("\n"),
            "Nettsiden er ofte starten. Ved behov kan vi også ta oss av mer av den digitale siden, som synlighet i søk, CRM, automatisering og teknisk støtte, slik at du kan konsentrere deg om å drive bedriften.",
            "Vi kan også bli med etter lanseringen – månedlig, som et avgrenset prosjekt eller, for utvalgte bedrifter, som et langsiktig samarbeid.",
            "Er dette relevant, kan du bare svare på denne e-posten. Vi hører gjerne om bedriften din.",
          ].join("\n\n"),
          cta: { label: "Se hvordan vi kan hjelpe", url: pageUrl("no", "/") },
        }
      : { subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, cta: { ...DEFAULT_TEMPLATE.cta } },

  "no-website": (locale, ctx) => {
    const company = clean(ctx.companyName);
    const city = clean(ctx.city, 40);
    if (locale === "no") {
      const observation =
        company && ctx.websiteResearched
          ? `Vi så etter ${company} på nett og fant ingen egen nettside.`
          : company && ctx.newlyRegistered
            ? `Vi så at ${company} nylig er registrert${city ? ` i ${city}` : ""} – gratulerer.`
            : "Vi hjelper små bedrifter med å bli lettere å finne og forstå på nett.";
      return {
        subject: company ? `En profesjonell nettside for ${company}` : "En profesjonell nettside for bedriften din",
        body: [
          greeting(locale, ctx),
          `${observation} Mange kunder søker på nett før de tar kontakt, så en tydelig nettside er ofte det første inntrykket av en bedrift.`,
          "## Et konkret forslag",
          [
            "- **Presentasjonsnettside**: Tydelig informasjon om hva dere tilbyr, tilpasset mobil.",
            "- **Synlig på Google**: Grunnleggende søkeoptimalisering og Google-bedriftsprofil.",
            "- **Enkel kontakt**: Et skjema som gjør det lett for kunder å nå dere direkte.",
            `- **Pris og levering**: ${priceLine(ctx, locale)}. ${deliveryLine(ctx, locale)}.`,
          ].join("\n"),
          buildFirstLine(locale),
          closing(locale),
        ].join("\n\n"),
        cta: { label: "Les om nettsideutvikling", url: offerUrl(ctx, locale) },
      };
    }
    const observation =
      company && ctx.websiteResearched
        ? `We looked for ${company} online and could not find a dedicated website.`
        : company && ctx.newlyRegistered
          ? `We noticed that ${company} was recently registered${city ? ` in ${city}` : ""} — congratulations.`
          : "We help small businesses become easier to find and understand online.";
    return {
      subject: company ? `A professional website for ${company}` : "A professional website for your business",
      body: [
        greeting(locale, ctx),
        `${observation} Many customers search online before they get in touch, so a clear website is often the first impression of a business.`,
        "## A concrete offer",
        [
          "- **Presentation website**: Clear information about what you offer, built for mobile.",
          "- **Found on Google**: Basic search optimisation and a Google Business Profile.",
          "- **Easy contact**: A simple form so customers can reach you directly.",
          `- **Price and delivery**: ${priceLine(ctx, locale)}. ${deliveryLine(ctx, locale)}.`,
        ].join("\n"),
        buildFirstLine(locale),
        closing(locale),
      ].join("\n\n"),
      cta: { label: "About website development", url: offerUrl(ctx, locale) },
    };
  },

  "has-website": (locale, ctx) => {
    const company = clean(ctx.companyName);
    const site = clean(ctx.website?.replace(/^https?:\/\//, "").replace(/\/$/, ""), 60);
    const notes: string[] = [];
    if (ctx.audit?.https === false) notes.push(locale === "no" ? "nettsiden ser ikke ut til å bruke en sikker tilkobling (HTTPS)" : "the site does not appear to use a secure connection (HTTPS)");
    if (ctx.audit?.mobileFriendly === false) notes.push(locale === "no" ? "den ser ikke ut til å være tilpasset mobil" : "it does not appear to be optimised for mobile");
    if (locale === "no") {
      const seen = site ? `Vi har sett på ${site}${notes.length ? `, og la merke til at ${notes.join(" og ")}` : ""}.` : "Vi har sett på nettsiden deres.";
      return {
        subject: company ? `Noen forslag til nettsiden til ${company}` : "Noen forslag til nettsiden deres",
        body: [
          greeting(locale, ctx),
          `${seen} Det kan være en mulighet til å gjøre det enklere for kunder å finne dere på Google og å ta kontakt.`,
          "## Det vi kan hjelpe med",
          [
            "- **Synlighet i søk**: Teknisk gjennomgang og forbedring av de viktigste sidene.",
            "- **Flere henvendelser**: Tydeligere veier til kontakt og forespørsel.",
            "- **Mobil og hastighet**: En opplevelse som fungerer godt på alle enheter.",
            `- **Pris**: ${priceLine(ctx, locale)}.`,
          ].join("\n"),
          closing(locale),
        ].join("\n\n"),
        cta: { label: "Les om SEO og synlighet", url: offerUrl(ctx, locale) },
      };
    }
    const seen = site ? `We had a look at ${site}${notes.length ? ` and noticed that ${notes.join(" and ")}` : ""}.` : "We had a look at your website.";
    return {
      subject: company ? `A few ideas for ${company}'s website` : "A few ideas for your website",
      body: [
        greeting(locale, ctx),
        `${seen} There may be an opportunity to make it easier for customers to find you on Google and to get in touch.`,
        "## Where we can help",
        [
          "- **Search visibility**: A technical review and improvements to your key pages.",
          "- **More enquiries**: Clearer paths to contact and request a quote.",
          "- **Mobile and speed**: An experience that works well on every device.",
          `- **Price**: ${priceLine(ctx, locale)}.`,
        ].join("\n"),
        closing(locale),
      ].join("\n\n"),
      cta: { label: "About SEO and visibility", url: offerUrl(ctx, locale) },
    };
  },

  recruitment: (locale, ctx) => {
    const company = clean(ctx.companyName);
    if (locale === "no") {
      return {
        subject: company ? `Hjelp med rekruttering hos ${company}` : "Hjelp med rekruttering",
        body: [
          greeting(locale, ctx),
          `Vi så at ${company ?? "dere"} ser ut til å ansette. For bedrifter uten egen HR-avdeling tar rekruttering ofte mye tid bort fra driften.`,
          "## Slik kan vi hjelpe",
          [
            "- **Annonse**: Stillingsbeskrivelse og publisering i relevante kanaler.",
            "- **Kandidater**: Søk og første utvelgelse av kandidater.",
            "- **Intervjuer**: Koordinering – dere tar den endelige avgjørelsen.",
            `- **Pris**: ${priceLine(ctx, locale)}.`,
          ].join("\n"),
          closing(locale),
        ].join("\n\n"),
        cta: { label: "Les om rekrutteringsstøtte", url: offerUrl(ctx, locale) },
      };
    }
    return {
      subject: company ? `Recruitment support for ${company}` : "Recruitment support for your business",
      body: [
        greeting(locale, ctx),
        `We noticed that ${company ?? "your business"} appears to be hiring. For businesses without their own HR team, recruitment often takes a lot of time away from running the business.`,
        "## How we can help",
        [
          "- **Job ad**: Role description and publishing on relevant channels.",
          "- **Candidates**: Sourcing and first screening of candidates.",
          "- **Interviews**: Coordination — you make the final decision.",
          `- **Price**: ${priceLine(ctx, locale)}.`,
        ].join("\n"),
        closing(locale),
      ].join("\n\n"),
      cta: { label: "About recruitment support", url: offerUrl(ctx, locale) },
    };
  },

  operations: (locale, ctx) => {
    const company = clean(ctx.companyName);
    if (locale === "no") {
      return {
        subject: company ? `Mindre manuelt arbeid hos ${company}` : "Mindre manuelt arbeid i bedriften",
        body: [
          greeting(locale, ctx),
          "Mange små bedrifter bruker mye tid på å holde oversikt over kunder, henvendelser og oppfølging i e-post og regneark.",
          "## Et konkret forslag",
          [
            "- **CRM**: Kunder, henvendelser og neste steg samlet på ett sted.",
            "- **Koblet til nettsiden**: Henvendelser går rett inn, så ingenting blir borte.",
            "- **Automatisering**: Påminnelser og rutineoppgaver som går av seg selv.",
            `- **Pris**: ${priceLine(ctx, locale)}.`,
          ].join("\n"),
          closing(locale),
        ].join("\n\n"),
        cta: { label: "Les om nettside med CRM", url: offerUrl(ctx, locale) },
      };
    }
    return {
      subject: company ? `Less manual work at ${company}` : "Less manual work in your business",
      body: [
        greeting(locale, ctx),
        "Many small businesses spend a lot of time keeping track of customers, enquiries and follow-ups in email and spreadsheets.",
        "## A concrete offer",
        [
          "- **CRM**: Customers, enquiries and next steps in one place.",
          "- **Connected to your website**: Enquiries arrive automatically, so nothing gets lost.",
          "- **Automation**: Reminders and routine tasks that run by themselves.",
          `- **Price**: ${priceLine(ctx, locale)}.`,
        ].join("\n"),
        closing(locale),
      ].join("\n\n"),
      cta: { label: "About website + CRM", url: offerUrl(ctx, locale) },
    };
  },

  reminder: (locale, ctx) => {
    const company = clean(ctx.companyName);
    if (locale === "no") {
      return {
        subject: company ? `Oppfølging: e-posten vår til ${company}` : "Oppfølging av e-posten vår",
        body: [
          greeting(locale, ctx),
          "En kort oppfølging av e-posten vi sendte for en stund siden.",
          "Passer det ikke nå, er det helt i orden – da tar vi ikke kontakt igjen. Er det interessant, kan du bare svare på denne e-posten.",
        ].join("\n\n"),
      };
    }
    return {
      subject: company ? `Following up on our email to ${company}` : "Following up on our email",
      body: [
        greeting(locale, ctx),
        "A short follow-up on the email we sent a little while ago.",
        "If it isn't relevant right now, that's completely fine — we won't contact you again. If it is, simply reply to this email.",
      ].join("\n\n"),
    };
  },
};

/** Template reference stored with the send record (never the body). The English general template keeps its historic id. */
export function templateRef(id: OutreachTemplateId, locale: EmailLocale) {
  return id === "general" && locale === "en" ? DEFAULT_TEMPLATE.id : `${id}-${VERSION}-${locale}`;
}

/** The ready-to-send content for one template, language and (optional) company context. */
export function buildOutreachEmail(id: OutreachTemplateId, locale: EmailLocale, ctx: OutreachContext = {}): EmailContent & { templateId: OutreachTemplateId; ref: string } {
  const built = BUILDERS[id](locale, ctx);
  return { subject: built.subject, body: built.body, includeCta: !!built.cta, cta: built.cta, locale, templateId: id, ref: templateRef(id, locale) };
}

/** Company fields the suggestion and personalisation use (all optional). */
export type OutreachCompany = {
  companyName?: string | null;
  countryCode?: string | null;
  website?: string | null;
  city?: string | null;
  registrationDay?: string | null;
  contactPerson?: { name?: string | null } | null;
  research?: { attempts?: number | null } | null;
  signals?: { hiring?: boolean | null } | null;
  auditSummary?: { https?: boolean | null; mobileFriendly?: boolean | null } | null;
};

export function outreachContext(c: OutreachCompany, now = new Date()): OutreachContext {
  const day = c.registrationDay ? Date.parse(`${c.registrationDay}T00:00:00Z`) : NaN;
  return {
    companyName: c.companyName ?? undefined,
    contactName: c.contactPerson?.name ?? undefined,
    city: c.city ?? undefined,
    website: c.website ?? undefined,
    newlyRegistered: Number.isFinite(day) && now.getTime() - day <= 60 * 86_400_000,
    websiteResearched: !c.website && (c.research?.attempts ?? 0) > 0,
    audit: c.auditSummary ?? null,
  };
}

/**
 * The most relevant first email for a company — never an irrelevant offer:
 * hiring signal → recruitment; no website → website offer; otherwise → visibility offer.
 * Norwegian for Norwegian companies, English otherwise (the Owner can change both).
 */
export function suggestOutreach(c: OutreachCompany): { templateId: OutreachTemplateId; locale: EmailLocale; reason: string } {
  const locale: EmailLocale = c.countryCode === "NO" ? "no" : "en";
  if (c.signals?.hiring) return { templateId: "recruitment", locale, reason: "A hiring signal was found for this company." };
  if (!c.website) return { templateId: "no-website", locale, reason: (c.research?.attempts ?? 0) > 0 ? "No website was found by contact research." : "No website is known for this company." };
  return { templateId: "has-website", locale, reason: "The company has a website." };
}
