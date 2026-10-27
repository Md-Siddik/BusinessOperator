/** Generate docs/coverage/jurisdictions.md from the jurisdiction catalogue (single source of truth). */
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_LABELS, INTEGRATION_STATE_LABELS, JURISDICTIONS } from "../src/config/jurisdictions";

const esc = (v: string) => v.replace(/\|/g, "\|").replace(/\n/g, " ");
const lines: string[] = [
  "# Jurisdiction coverage report",
  "",
  "_Generated from `src/config/jurisdictions.ts` by `npm run coverage:report`. Do not edit by hand._",
  "",
  "A jurisdiction listed here is **not** an integration. Evidence levels: Documented → Configured → Authenticated → Real-data tested → Freshness measured.",
  "Text \"Not yet verified\" means the field has not been checked against official documentation.",
  "",
  "## Summary",
  "",
  "| State | Count |",
  "|---|---|",
];
const byState = new Map<string, number>();
for (const j of JURISDICTIONS) byState.set(j.state, (byState.get(j.state) ?? 0) + 1);
for (const [k, n] of byState) lines.push(`| ${INTEGRATION_STATE_LABELS[k as keyof typeof INTEGRATION_STATE_LABELS]} | ${n} |`);
lines.push("", "## Jurisdictions", "", "| Jurisdiction | Group | Scope | State | Evidence | Adapter | Official registry | API / feed | Registration date means | Contact fields | Update frequency | Update window | Access | Permitted use |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const j of JURISDICTIONS) {
  lines.push(
    `| ${j.flag} ${j.name} (${j.code}) | ${j.group} | ${j.scope} | ${INTEGRATION_STATE_LABELS[j.state]} | ${EVIDENCE_LABELS[j.evidence]} | ${j.providers.join(", ") || "—"} | [${esc(j.registry.name)}](${j.registry.url}) | ${esc(j.feed)} | ${esc(j.registrationDateMeaning)} | ${esc(j.contactFields)} | ${esc(j.updateFrequency)} | ${j.timeliness} — ${esc(j.updateWindow)} | ${esc(j.access)} | ${esc(j.permittedUse)}${j.notes ? ` _(${esc(j.notes)})_` : ""} |`,
  );
}
const out = path.join(process.cwd(), "docs", "coverage", "jurisdictions.md");
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.info(`Wrote ${out} (${JURISDICTIONS.length} jurisdictions)`);
