/**
 * Company identity keys shared by the Old company Intelligence duplicate checks. Pure (no DB),
 * so the collection, the sweep and the tests compute exactly the same keys.
 */

/** Legal-form words dropped from names before comparing ("Acme AS" = "ACME A/S" = "Acme"). */
const LEGAL_FORMS = new Set([
  "as", "asa", "a/s", "ans", "da", "enk", "nuf", "sa", "oy", "oyj", "ab", "ky", "tmi", "ltd", "limited", "dac", "clg", "uc", "plc", "llc", "l.l.c", "llp", "lp", "inc", "incorporated",
  "corp", "corporation", "co", "company", "pty", "proprietary", "pc", "pllc", "gmbh", "ag", "sarl", "sas", "bv", "nv", "srl", "spa", "sp", "zoo", "z.o.o", "the",
]);

/** Lower case, no diacritics, no punctuation, no legal-form words, single spaces. */
export function normalizeCompanyName(name: string) {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Letters NFKD does not decompose.
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/þ/g, "th")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/.\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[./]+|[./]+$/g, ""))
    .filter(Boolean);
  const core = words.filter((w) => !LEGAL_FORMS.has(w));
  return (core.length ? core : words).join(" ").replace(/[./]/g, "");
}

/** Registration numbers compared on letters and digits only ("123 456 789" = "123456789"). */
export function normalizeRegistrationNumber(value: string | null | undefined) {
  const v = (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return v || undefined;
}

export type IdentityInput = { countryCode: string; source: string; sourceId: string; registrationNumber?: string | null; companyName: string };

/** Unique identity keys of one registered company (stored and uniquely indexed). */
export function identityKeys(c: IdentityInput) {
  const cc = c.countryCode.toUpperCase();
  const reg = normalizeRegistrationNumber(c.registrationNumber);
  return [`src:${cc}:${c.source}:${c.sourceId}`, ...(reg ? [`reg:${cc}:${reg}`] : [])];
}

/** Name key used for the cross-module check (country-scoped). */
export function nameKeyOf(countryCode: string, companyName: string) {
  return `${countryCode.toUpperCase()}:${normalizeCompanyName(companyName)}`;
}
