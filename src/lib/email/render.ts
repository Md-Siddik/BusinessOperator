/**
 * Template rendering with {{variable}} placeholders. Missing values render as
 * empty strings and are reported, so drafts never contain invented facts and
 * reviewers can see what data was unavailable.
 */
export const TEMPLATE_VARIABLES = [
  "companyName",
  "contactName",
  "industry",
  "country",
  "website",
  "registrationDate",
  "city",
  "senderName",
  "unsubscribeUrl",
] as const;

export type TemplateVariables = Partial<Record<(typeof TEMPLATE_VARIABLES)[number] | string, string | undefined | null>>;

export function renderTemplate(template: string, vars: TemplateVariables) {
  const missing = new Set<string>();
  const used = new Set<string>();
  // {{name}} or {{name|neutral fallback}} — the fallback is neutral wording, never an invented fact.
  const output = template.replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (_, name: string, fallback?: string) => {
    used.add(name);
    const value = vars[name];
    if (value === undefined || value === null || value === "") {
      missing.add(name);
      return fallback?.trim() ?? "";
    }
    return String(value);
  });
  return {
    output: output
      .replace(/[ \t]+([,.!?])/g, "$1")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/ {2,}/g, " "),
    missing: [...missing],
    used: [...used],
  };
}

export function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text → minimal, safe HTML (escaped, paragraphs, line breaks). */
export function textToHtml(text: string) {
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${paragraphs}</div>`;
}
