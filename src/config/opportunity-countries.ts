import { getJurisdiction } from "./jurisdictions";

/**
 * Countries supported by Verified Opportunity Intelligence. Adding a country =
 * one entry here + provider coverage declarations; no UI or schema changes.
 *
 * `locationNames` are used only to recognise a country inside free-text ATS
 * locations ("Remote, Sweden", "Oslo, Norge"). Postings whose location cannot be
 * attributed to a supported country are skipped (counted in the sync run), never guessed.
 *
 * `procurementNotes` / `hiringNotes` are general orientation about where official
 * notices are published — they are not legal advice.
 */
export type OpportunityCountry = {
  code: string;
  iso3: string;
  name: string;
  flag: string;
  timezone: string;
  locationNames: string[];
  /** Major cities — a city name alone attributes a posting to the country. */
  cities: string[];
  hiringNotes: string;
  procurementNotes: string;
  /** Prefix(es) of the national company registration number system, for display only. */
  registrationNumberLabel: string;
};

const tz = (code: string, fallback: string) => getJurisdiction(code)?.timezone ?? fallback;

export const OPPORTUNITY_COUNTRIES: OpportunityCountry[] = [
  {
    code: "NO",
    iso3: "NOR",
    name: "Norway",
    flag: "🇳🇴",
    timezone: tz("NO", "Europe/Oslo"),
    locationNames: ["norway", "norge", "noreg"],
    cities: ["oslo", "bergen", "trondheim", "stavanger", "kristiansand", "tromsø", "tromso", "drammen", "fredrikstad", "sandnes", "bodø", "ålesund"],
    hiringNotes: "Arbeidsplassen (NAV) publishes job vacancies through an official feed; access requires accepting NAV's API terms and a consumer token.",
    procurementNotes: "Norway (EEA) publishes notices above EEA thresholds on TED; national notices are published on Doffin (doffin.no).",
    registrationNumberLabel: "Organisasjonsnummer",
  },
  {
    code: "SE",
    iso3: "SWE",
    name: "Sweden",
    flag: "🇸🇪",
    timezone: tz("SE", "Europe/Stockholm"),
    locationNames: ["sweden", "sverige"],
    cities: ["stockholm", "göteborg", "gothenburg", "goteborg", "malmö", "malmo", "uppsala", "västerås", "örebro", "linköping", "helsingborg", "lund", "umeå"],
    hiringNotes: "Arbetsförmedlingen (Platsbanken) publishes job ads through the open JobTech JobSearch and JobStream APIs, including the employer's organisation number.",
    procurementNotes: "Notices above EU thresholds are published on TED. Sweden has no single free national notice API; national databases are operated by commercial providers.",
    registrationNumberLabel: "Organisationsnummer",
  },
  {
    code: "DK",
    iso3: "DNK",
    name: "Denmark",
    flag: "🇩🇰",
    timezone: tz("DK", "Europe/Copenhagen"),
    locationNames: ["denmark", "danmark"],
    cities: ["copenhagen", "københavn", "kobenhavn", "aarhus", "århus", "odense", "aalborg", "esbjerg"],
    hiringNotes: "No open official national job-ad API has been verified (Jobnet has no public data API). Hiring coverage comes from configured employer ATS boards and careers pages only.",
    procurementNotes: "Notices above EU thresholds are published on TED; national notices on udbud.dk.",
    registrationNumberLabel: "CVR-nummer",
  },
  {
    code: "FI",
    iso3: "FIN",
    name: "Finland",
    flag: "🇫🇮",
    timezone: tz("FI", "Europe/Helsinki"),
    locationNames: ["finland", "suomi"],
    cities: ["helsinki", "espoo", "tampere", "vantaa", "oulu", "turku", "jyväskylä", "jyvaskyla", "lahti", "kuopio"],
    hiringNotes: "An official national job-ad API (Työmarkkinatori) has not yet been verified for this use. Hiring coverage comes from configured employer ATS boards and careers pages only.",
    procurementNotes: "Notices above EU thresholds are published on TED; national notices on Hilma (hankintailmoitukset.fi), whose API requires a subscription key.",
    registrationNumberLabel: "Y-tunnus",
  },
  {
    code: "DE",
    iso3: "DEU",
    name: "Germany",
    flag: "🇩🇪",
    timezone: tz("DE", "Europe/Berlin"),
    locationNames: ["germany", "deutschland"],
    cities: ["berlin", "munich", "münchen", "muenchen", "hamburg", "frankfurt", "cologne", "köln", "koeln", "stuttgart", "düsseldorf", "dusseldorf", "leipzig", "dresden", "hannover", "nuremberg", "nürnberg"],
    hiringNotes: "The Bundesagentur für Arbeit job search API is documented only by a community project; its terms for this use are not verified, so it is not integrated. Adzuna (aggregator) covers Germany when configured.",
    procurementNotes: "Notices above EU thresholds are published on TED; national notices via the Bekanntmachungsservice (oeffentlichevergabe.de) — not yet integrated.",
    registrationNumberLabel: "Handelsregisternummer",
  },
  {
    code: "FR",
    iso3: "FRA",
    name: "France",
    flag: "🇫🇷",
    timezone: tz("FR", "Europe/Paris"),
    locationNames: ["france"],
    cities: ["paris", "lyon", "marseille", "toulouse", "nice", "nantes", "strasbourg", "montpellier", "bordeaux", "lille", "rennes"],
    hiringNotes: "France Travail publishes job offers through its official Offres d'emploi API (free registration on francetravail.io, OAuth client credentials).",
    procurementNotes: "Notices above EU thresholds are published on TED (and mirrored in BOAMP's JOUE family); national notices (MAPA / FNS) are published in BOAMP open data.",
    registrationNumberLabel: "SIREN",
  },
  {
    code: "GB",
    iso3: "GBR",
    name: "United Kingdom",
    flag: "🇬🇧",
    timezone: tz("GB", "Europe/London"),
    locationNames: ["united kingdom", "uk", "great britain", "england", "scotland", "wales", "northern ireland"],
    cities: ["london", "manchester", "birmingham", "edinburgh", "glasgow", "leeds", "bristol", "liverpool", "cardiff", "belfast", "cambridge", "oxford"],
    hiringNotes: "No open official national job-ad API (DWP Find a job has no public API). Adzuna (aggregator) covers the UK when configured.",
    procurementNotes: "Since leaving the EU, UK notices are published on Find a Tender (above thresholds) and Contracts Finder (England, lower-value), both as open OCDS data.",
    registrationNumberLabel: "Company number",
  },
];

export const OPPORTUNITY_COUNTRY_CODES = OPPORTUNITY_COUNTRIES.map((c) => c.code);

export function getOpportunityCountry(code: string | null | undefined) {
  if (!code) return undefined;
  const c = code.toUpperCase();
  return OPPORTUNITY_COUNTRIES.find((x) => x.code === c || x.iso3 === c);
}

const ISO2_ALIASES: Record<string, string> = { UK: "GB" };

/**
 * Attribute a free-text location to a supported country, or undefined.
 * Matches ISO codes as whole tokens, country names, native names and major cities.
 */
export function detectCountry(...locations: (string | null | undefined)[]): string | undefined {
  for (const raw of locations) {
    if (!raw) continue;
    const text = raw.toLowerCase();
    const tokens = new Set(text.split(/[^a-zæøåäöüéèß]+/i).filter(Boolean));
    for (const c of OPPORTUNITY_COUNTRIES) {
      if (c.locationNames.some((n) => (n.includes(" ") ? text.includes(n) : tokens.has(n)))) return c.code;
    }
    for (const c of OPPORTUNITY_COUNTRIES) {
      if (c.cities.some((n) => tokens.has(n))) return c.code;
    }
    // Bare ISO alpha-2 tokens in upper case only (avoid "de"/"no" as words).
    const upperTokens = new Set(raw.split(/[^A-Z]+/).filter((t) => t.length === 2));
    for (const t of upperTokens) {
      const code = ISO2_ALIASES[t] ?? t;
      if (OPPORTUNITY_COUNTRY_CODES.includes(code)) return code;
    }
  }
  return undefined;
}
