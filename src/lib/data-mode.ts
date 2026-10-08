/**
 * Data mode policy for company intelligence.
 *
 *  REAL (default): only real registry providers can be selected; demo
 *  companies are hidden everywhere. A failing provider is shown as
 *  unavailable — it is never replaced with generated data.
 *
 *  DEMO: generated, clearly-labelled demo companies may be used. Allowed
 *  only outside production, or in production when the Owner explicitly
 *  sets ALLOW_DEMO_IN_PRODUCTION=true. REAL_DATA_MODE=true always wins.
 */
export function isDemoModeEnabled(): boolean {
  if (process.env.REAL_DATA_MODE === "true") return false;
  if (process.env.DEMO_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_IN_PRODUCTION !== "true") return false;
  return true;
}

/** Mongo filter that hides demo companies unless demo mode is on. */
export function companyVisibilityFilter(): Record<string, unknown> {
  return isDemoModeEnabled() ? {} : { isDemo: { $ne: true } };
}
