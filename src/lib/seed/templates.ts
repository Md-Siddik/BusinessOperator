/**
 * Demo outreach templates — one per country/language pair plus an
 * international English fallback. Country and language are independent:
 * Norway has both Norwegian and English templates.
 * Variables only reference stored facts; nothing is invented.
 */
export const DEMO_TEMPLATES = [
  {
    name: "New company — digital foundation (NO)",
    countryCode: "NO",
    languageCode: "no",
    serviceCategory: "digital-foundation",
    subject: "Gratulerer med nyregistreringen, {{companyName}}",
    body: `Hei {{contactName}},

Gratulerer med registreringen av {{companyName}} den {{registrationDate}}.

Vi i ExploreTechify hjelper nye bedrifter innen {{industry}} med den digitale siden — nettside, bedrifts-e-post, Google-bedriftsprofil og systemer — slik at dere kan fokusere på kundene.

Her er en kort oversikt over hvordan vi jobber: https://exploretechify.com/no/services

Passer det med en uforpliktende prat på 15 minutter?

Vennlig hilsen
{{senderName}}`,
  },
  {
    name: "New company — digital foundation (NO, English)",
    countryCode: "NO",
    languageCode: "en",
    serviceCategory: "digital-foundation",
    subject: "Congratulations on registering {{companyName}}",
    body: `Hi {{contactName|there}},

Congratulations on registering {{companyName}} in {{country}}.

ExploreTechify works as an external digital operations team for new businesses — website, business email, Google Business Profile and simple systems — so you can focus on customers.

A quick overview of how we can help: https://exploretechify.com/services

Would a short, no-obligation call be useful?

Best regards,
{{senderName}}`,
  },
  {
    name: "Nystartat bolag — digital grund (SE)",
    countryCode: "SE",
    languageCode: "sv",
    serviceCategory: "digital-foundation",
    subject: "Grattis till registreringen, {{companyName}}",
    body: `Hej {{contactName}},

Grattis till registreringen av {{companyName}}.

ExploreTechify hjälper nya företag inom {{industry}} med den digitala sidan — webbplats, företagsmejl, Google-företagsprofil och system — så att ni kan fokusera på verksamheten.

En snabb överblick: https://exploretechify.com/sv/services

Passar det med ett kort samtal utan förpliktelser?

Vänliga hälsningar
{{senderName}}`,
  },
  {
    name: "Ny virksomhed — digitalt fundament (DK)",
    countryCode: "DK",
    languageCode: "da",
    serviceCategory: "digital-foundation",
    subject: "Tillykke med registreringen, {{companyName}}",
    body: `Hej {{contactName}},

Tillykke med registreringen af {{companyName}}.

ExploreTechify hjælper nye virksomheder inden for {{industry}} med den digitale side — hjemmeside, e-mail, Google Virksomhedsprofil og systemer — så I kan fokusere på kunderne.

Et hurtigt overblik: https://exploretechify.com/da/services

Har I tid til en kort, uforpligtende snak?

Venlig hilsen
{{senderName}}`,
  },
  {
    name: "Uusi yritys — digitaalinen perusta (FI)",
    countryCode: "FI",
    languageCode: "fi",
    serviceCategory: "digital-foundation",
    subject: "Onnittelut rekisteröinnistä, {{companyName}}",
    body: `Hei {{contactName}},

Onnittelut yrityksen {{companyName}} rekisteröinnistä.

ExploreTechify auttaa uusia yrityksiä digitaalisen puolen kanssa — verkkosivut, yrityssähköposti, Google-yritysprofiili ja järjestelmät — jotta voitte keskittyä asiakkaisiin.

Lyhyt katsaus: https://exploretechify.com/fi/services

Sopisiko lyhyt, sitoumukseton keskustelu?

Ystävällisin terveisin
{{senderName}}`,
  },
  {
    name: "Neugründung — digitales Fundament (DE)",
    countryCode: "DE",
    languageCode: "de",
    serviceCategory: "digital-foundation",
    subject: "Herzlichen Glückwunsch zur Gründung, {{companyName}}",
    body: `Guten Tag {{contactName}},

herzlichen Glückwunsch zur Eintragung der {{companyName}}.

ExploreTechify unterstützt neu gegründete Unternehmen im Bereich {{industry}} bei der digitalen Seite — Website, geschäftliche E-Mail, Google-Unternehmensprofil und Systeme — damit Sie sich auf Ihre Kunden konzentrieren können.

Ein kurzer Überblick: https://exploretechify.com/de/services

Hätten Sie Interesse an einem kurzen, unverbindlichen Gespräch?

Mit freundlichen Grüßen
{{senderName}}`,
  },
  {
    name: "Nouvelle société — fondations digitales (FR)",
    countryCode: "FR",
    languageCode: "fr",
    serviceCategory: "digital-foundation",
    subject: "Félicitations pour l'immatriculation de {{companyName}}",
    body: `Bonjour {{contactName}},

Félicitations pour l'immatriculation de {{companyName}}.

ExploreTechify accompagne les jeunes entreprises du secteur {{industry}} sur le volet digital — site web, messagerie professionnelle, fiche Google et outils — pour que vous puissiez vous concentrer sur vos clients.

Un aperçu rapide : https://exploretechify.com/fr/services

Seriez-vous disponible pour un court échange sans engagement ?

Cordialement,
{{senderName}}`,
  },
  {
    name: "New company — digital foundation (GB)",
    countryCode: "GB",
    languageCode: "en",
    serviceCategory: "digital-foundation",
    subject: "Congratulations on incorporating {{companyName}}",
    body: `Hi {{contactName|there}},

Congratulations on incorporating {{companyName}}.

ExploreTechify acts as an external digital operations team for new {{industry}} businesses — website, business email, Google Business Profile and simple systems — so you can focus on customers.

A quick overview: https://exploretechify.com/services

Would a short, no-obligation call be helpful?

Best regards,
{{senderName}}`,
  },
  {
    name: "Hiring support (International)",
    countryCode: "INTL",
    languageCode: "en",
    serviceCategory: "people-recruitment",
    subject: "Support while {{companyName}} grows its team",
    body: `Hi {{contactName|there}},

Growing a new company and hiring at the same time is a lot. ExploreTechify supports recruitment and onboarding as part of running the digital and admin side of your business.

How we work: https://exploretechify.com/services/people-recruitment

Happy to share how this could look for {{companyName}}.

Best regards,
{{senderName}}`,
  },
];
