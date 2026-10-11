import "server-only";
import { adzunaProvider } from "./adzuna";
import { ashbyProvider, greenhouseProvider, leverProvider } from "./ats";
import { boampProvider } from "./boamp-fr";
import { careersPageProvider } from "./careers-page";
import { franceTravailProvider } from "./france-travail";
import { jobtechProvider } from "./jobtech-se";
import { navProvider } from "./nav-no";
import { tedProvider } from "./ted";
import { contractsFinderProvider, findATenderProvider } from "./uk-ocds";
import type { OpportunityProvider } from "./types";

/** Every implemented provider. Order = display order. */
export const OPPORTUNITY_PROVIDERS: OpportunityProvider[] = [
  jobtechProvider,
  navProvider,
  franceTravailProvider,
  greenhouseProvider,
  leverProvider,
  ashbyProvider,
  careersPageProvider,
  adzunaProvider,
  tedProvider,
  findATenderProvider,
  contractsFinderProvider,
  boampProvider,
];

export function getOpportunityProvider(id: string): OpportunityProvider | undefined {
  return OPPORTUNITY_PROVIDERS.find((p) => p.id === id);
}

/**
 * Candidate sources evaluated but NOT integrated, with the reason. Shown in the
 * coverage matrix so gaps are explicit instead of hidden.
 */
export type CandidateSource = { id: string; name: string; type: "HIRING" | "PROCUREMENT"; countries: string[]; status: "NEEDS_CREDENTIALS" | "NEEDS_AGREEMENT" | "NOT_IMPLEMENTED"; reason: string; url: string };

export const CANDIDATE_SOURCES: CandidateSource[] = [
  { id: "doffin", name: "Doffin public API (Norway)", type: "PROCUREMENT", countries: ["NO"], status: "NEEDS_CREDENTIALS", reason: "National Norwegian notices (incl. below EEA thresholds). The public API requires a subscription key from Doffin's developer portal; adapter not yet written.", url: "https://doffin.no" },
  { id: "hilma", name: "Hilma open data API (Finland)", type: "PROCUREMENT", countries: ["FI"], status: "NEEDS_CREDENTIALS", reason: "National Finnish notices. API access requires a subscription key; adapter not yet written.", url: "https://hankintailmoitukset.fi" },
  { id: "udbud-dk", name: "udbud.dk (Denmark)", type: "PROCUREMENT", countries: ["DK"], status: "NOT_IMPLEMENTED", reason: "No documented open notice API verified. Danish above-threshold notices are covered by TED.", url: "https://udbud.dk" },
  { id: "oeffentlichevergabe-de", name: "Bekanntmachungsservice / oeffentlichevergabe.de (Germany)", type: "PROCUREMENT", countries: ["DE"], status: "NOT_IMPLEMENTED", reason: "National German notice data service; access method and reuse terms not yet verified.", url: "https://oeffentlichevergabe.de" },
  { id: "se-national-procurement", name: "Swedish national notice databases", type: "PROCUREMENT", countries: ["SE"], status: "NEEDS_AGREEMENT", reason: "Below-threshold Swedish notices are distributed by commercial registered databases (e.g. e-Avrop, Visma Opic) under paid agreements.", url: "https://www.upphandlingsmyndigheten.se" },
  { id: "jobnet-dk", name: "Jobnet (Denmark)", type: "HIRING", countries: ["DK"], status: "NOT_IMPLEMENTED", reason: "No public data API for job ads has been verified.", url: "https://job.jobnet.dk" },
  { id: "tyomarkkinatori-fi", name: "Työmarkkinatori (Finland)", type: "HIRING", countries: ["FI"], status: "NOT_IMPLEMENTED", reason: "Official Finnish job marketplace; an open job-ad API and its terms for this use have not been verified.", url: "https://tyomarkkinatori.fi" },
  { id: "ba-jobsuche-de", name: "Bundesagentur für Arbeit Jobsuche (Germany)", type: "HIRING", countries: ["DE"], status: "NOT_IMPLEMENTED", reason: "Only community documentation (bund.dev) exists; official terms for automated reuse not verified.", url: "https://www.arbeitsagentur.de/jobsuche" },
  { id: "dwp-find-a-job", name: "DWP Find a job (UK)", type: "HIRING", countries: ["GB"], status: "NOT_IMPLEMENTED", reason: "No public API.", url: "https://findajob.dwp.gov.uk" },
  { id: "reed-uk", name: "Reed.co.uk Jobseeker API (UK)", type: "HIRING", countries: ["GB"], status: "NEEDS_CREDENTIALS", reason: "Job board (third-party for most ads); key required. Not integrated to avoid adding another aggregator.", url: "https://www.reed.co.uk/developers" },
];
