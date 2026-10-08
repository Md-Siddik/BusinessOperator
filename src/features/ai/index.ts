/**
 * Optional AI layer. Everything in the platform works without it.
 *
 * To enable: implement AiProvider (e.g. with the Anthropic SDK using a current
 * Claude model) and return it from getAiProvider() when AI_PROVIDER is set.
 * Intended uses: industry classification, lead-score explanations, company
 * summaries, outreach draft suggestions, CRM/meeting summaries, translation
 * assistance. AI output must always be reviewed by a human and must only use
 * facts present in the record — never invent details.
 */
export interface AiProvider {
  id: string;
  summarizeCompany(facts: Record<string, unknown>): Promise<string>;
  suggestOutreach(facts: Record<string, unknown>, languageCode: string): Promise<{ subject: string; body: string }>;
  translate(text: string, targetLanguage: string): Promise<string>;
}

export function getAiProvider(): AiProvider | null {
  return null;
}

export function isAiEnabled() {
  return getAiProvider() !== null;
}

/**
 * Rule-based, fact-only company summary used when AI is disabled. It never
 * adds information that isn't in the record.
 */
export function factualSummary(c: {
  companyName: string;
  legalForm?: string | null;
  industryDescription?: string | null;
  city?: string | null;
  registrationDate?: Date | string | null;
  website?: string | null;
  employees?: number | null;
}) {
  const parts = [`${c.companyName}${c.legalForm ? ` (${c.legalForm})` : ""}`];
  if (c.industryDescription) parts.push(`registered for “${c.industryDescription.toLowerCase().replace(/\.$/, "")}”`);
  if (c.city) parts.push(`in ${c.city}`);
  if (c.registrationDate) parts.push(`on ${new Date(c.registrationDate).toISOString().slice(0, 10)}`);
  let s = parts.join(" ") + ".";
  s += c.website ? " Has a website on record." : " No website on record.";
  if (c.employees != null) s += ` ${c.employees} registered employee${c.employees === 1 ? "" : "s"}.`;
  return s;
}
