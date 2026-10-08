import "server-only";
import { getJurisdiction, INTEGRATION_STATE_LABELS, type Jurisdiction } from "@/config/jurisdictions";
import { NO_CAPABILITIES, type CompanyRegistryProvider } from "../types";

/**
 * Placeholder for jurisdictions without an implemented feed. It fetches nothing
 * and carries the catalogue's honest state (Under research, Needs approval,
 * No verified feed found, …) so the dashboard never shows invented counts.
 */
export function createCatalogueProvider(j: Jurisdiction, id = `catalogue-${j.code.toLowerCase()}`): CompanyRegistryProvider {
  const notes = [j.feed !== "Not yet verified" ? `Candidate feed: ${j.feed}.` : null, j.access !== "Not yet verified" ? `Access: ${j.access}.` : null, j.notes].filter(Boolean).join(" ");
  return {
    id,
    countryCode: j.code,
    name: `${j.registry.name} — ${INTEGRATION_STATE_LABELS[j.state].toLowerCase()}`,
    sourceName: j.registry.name,
    sourceType: "OFFICIAL_REGISTRY",
    freshness: "UNKNOWN",
    isDemo: false,
    accessType: "NONE",
    catalogueState: j.state,
    homepage: j.registry.url,
    docsUrl: j.sources?.[0],
    description: `${j.name}: ${INTEGRATION_STATE_LABELS[j.state]}.`,
    limitations: notes || `${j.name} has no researched registration feed yet.`,
    capabilities: NO_CAPABILITIES,
    requiredEnv: [],
    isConfigured: () => false,
    recommendedSyncMinutes: 24 * 60,
    async checkStatus() {
      return { state: "NOT_CONNECTED", message: notes || undefined, checkedAt: new Date() };
    },
  };
}

/** Sweden: SCB access needs a certificate; Bolagsverket's free API is lookup-only. */
export function createBolagsverketProvider() {
  return createCatalogueProvider(getJurisdiction("SE")!, "bolagsverket");
}
