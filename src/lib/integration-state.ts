/**
 * UI helpers for integration states (client-safe). A country in the list is not
 * an integration — these states say exactly what is and isn't connected.
 */
export type UiIntegrationState = "CONNECTED" | "NOT_SYNCED" | "LOOKUP_ONLY" | "NEEDS_CREDENTIALS" | "NEEDS_APPROVAL" | "UNDER_RESEARCH" | "PROVIDER_ERROR" | "NO_VERIFIED_FEED";

export const STATE_LABELS: Record<UiIntegrationState, string> = {
  CONNECTED: "Connected",
  NOT_SYNCED: "Connected · not synced yet",
  LOOKUP_ONLY: "Lookup only",
  NEEDS_CREDENTIALS: "Needs credentials",
  NEEDS_APPROVAL: "Needs approval",
  UNDER_RESEARCH: "Under research",
  PROVIDER_ERROR: "Provider error",
  NO_VERIFIED_FEED: "No verified feed found",
};

/** States in which no daily registration feed runs. */
export function hasNoFeed(state: string) {
  return ["LOOKUP_ONLY", "NEEDS_CREDENTIALS", "NEEDS_APPROVAL", "UNDER_RESEARCH", "NO_VERIFIED_FEED"].includes(state);
}

export function needsAccess(state: string) {
  return state === "NEEDS_CREDENTIALS" || state === "NEEDS_APPROVAL";
}

/** Short sidebar hint for a country without a count today. */
export function navHint(state: string): { meta: string; title: string } {
  switch (state) {
    case "NEEDS_CREDENTIALS":
      return { meta: "key", title: "Needs credentials" };
    case "NEEDS_APPROVAL":
      return { meta: "appr.", title: "Needs approval (agreement / certificate)" };
    case "PROVIDER_ERROR":
      return { meta: "!", title: "Provider error" };
    case "UNDER_RESEARCH":
      return { meta: "res.", title: "Under research" };
    case "LOOKUP_ONLY":
      return { meta: "lookup", title: "Lookup only — no daily feed" };
    case "NO_VERIFIED_FEED":
      return { meta: "off", title: "No verified feed found" };
    default:
      return { meta: "—", title: "Today not synced yet" };
  }
}
