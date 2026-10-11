import "server-only";
import { createHttpClient } from "@/features/registry/http";
import { cleanUrl, parseDeadline, parseSourceDate, uniq } from "../normalize";
import type { FetchContext, FetchResult, NormalizedOpportunity, OpportunityProvider } from "./types";

/**
 * France — BOAMP (Bulletin officiel des annonces des marchés publics), DILA open data:
 *   GET https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records
 * Open, no key (Licence Ouverte). The JOUE family mirrors TED notices, so only national
 * families (FNS, MAPA) are read here to avoid duplicates; TED covers above-threshold.
 */
const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const http = createHttpClient({ name: "BOAMP open data", minIntervalMs: 500, timeoutMs: 45_000 });
const DEFAULT_DESCRIPTORS = ["Informatique (prestations de services)", "Logiciel", "Publicité, Communication", "Informatique (maintenance serveurs et réseaux)"];

type Rec = {
  idweb: string;
  objet?: string;
  famille?: string;
  dateparution?: string;
  datelimitereponse?: string | null;
  nomacheteur?: string;
  nature_libelle?: string;
  procedure_libelle?: string;
  descripteur_libelle?: string[] | null;
  descripteur_code?: string[] | null;
  type_marche?: string[] | null;
  url_avis?: string;
  code_departement?: string[] | null;
};

function descriptors(settings: Record<string, unknown>) {
  const raw = settings.descriptors;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\s*;\s*/) : [];
  const out = list.map((s) => s.trim()).filter(Boolean);
  return out.length ? out : DEFAULT_DESCRIPTORS;
}

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const boampProvider: OpportunityProvider = {
  id: "boamp-fr",
  name: "BOAMP — French public procurement notices",
  publisher: "DILA (Direction de l'information légale et administrative)",
  type: "PROCUREMENT",
  defaultSourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
  perEmployer: false,
  coverage: [{ code: "FR", level: "NATIONAL_OFFICIAL", note: "National notices (MAPA and FNS families); above-threshold notices come from TED." }],
  access: { type: "OPEN", requiredEnv: [], termsUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/", termsNote: "Open data (Licence Ouverte / Etalab); no key required." },
  docsUrl: "https://boamp-datadila.opendatasoft.com/explore/dataset/boamp/api/",
  homepage: "https://www.boamp.fr",
  description: "French calls for tender (avis de marché) with buyer, BOAMP descriptors, response deadline and the official notice link.",
  limitations: "Buyer registration numbers and contact details are inside the raw notice and are not extracted. Cancellations (ANNULATION notices) are not linked automatically; activity follows the response deadline.",
  capabilities: { incremental: true, pagination: true, publishedAt: true, updatedAt: false, deadline: true, removalDetection: "DEADLINE_ONLY", activityCheck: false, employerIdentity: "NAME_ONLY", contacts: false, webhooks: false, directApplyLink: false },
  evidence: "REAL_DATA_TESTED",
  freshnessNote: "BOAMP publishes daily; polled a few times a day.",
  recommendedIntervalMinutes: 360,
  settingFields: [
    { key: "descriptors", label: "BOAMP descriptors (separate with ;)", kind: "text", defaultValue: DEFAULT_DESCRIPTORS.join("; "), help: "Exact BOAMP descriptor labels to include." },
    { key: "initialDays", label: "Initial backfill (days)", kind: "number", defaultValue: 7, help: "How far back the first run reads." },
  ],
  isConfigured: () => ({ ok: true, missing: [] }),
  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const days = Math.min(Math.max(Number(ctx.feed.settings.initialDays ?? 7), 1), 60);
    // Cursor "YYYY-MM-DD" or "YYYY-MM-DD|offset" (stable order by date, idweb) — a capped run resumes at its offset.
    const [cursorDay, cursorOffset] = (ctx.cursor ?? "").split("|");
    const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(cursorDay ?? "") ? cursorDay! : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const startOffset = Math.max(0, Number(cursorOffset) || 0);
    const where = [`famille in ("FNS","MAPA")`, `nature="APPEL_OFFRE"`, `dateparution>=${q(fromDay)}`, `descripteur_libelle in (${descriptors(ctx.feed.settings).map(q).join(",")})`].join(" AND ");
    const items: NormalizedOpportunity[] = [];
    let complete = true;
    let maxDay = fromDay;
    const page = 100;
    let offset = startOffset;
    for (; ; offset += page) {
      if (items.length >= ctx.limit || offset >= 9900) {
        complete = false;
        break;
      }
      const params = new URLSearchParams({ where, limit: String(page), offset: String(offset), order_by: "dateparution asc, idweb asc" });
      const res = await http.json<{ results: Rec[] }>(`${API}?${params}`, { signal: ctx.signal });
      for (const r of res.results) {
        const { deadline, deadlineText } = parseDeadline(r.datelimitereponse ?? undefined);
        items.push({
          externalId: r.idweb,
          type: "PROCUREMENT",
          title: r.objet ?? r.idweb,
          organization: { name: r.nomacheteur },
          countryCode: "FR",
          location: r.code_departement?.length ? `Département ${r.code_departement.join(", ")}` : undefined,
          sourceUrl: cleanUrl(r.url_avis) ?? `https://www.boamp.fr/pages/avis/?q=idweb:${encodeURIComponent(r.idweb)}`,
          sourceClass: "OFFICIAL_PROCUREMENT_PORTAL",
          sourcePublisher: "BOAMP (DILA)",
          publishedAt: parseSourceDate(r.dateparution),
          deadline,
          deadlineText,
          classification: { scheme: "BOAMP descriptor", codes: uniq(r.descripteur_code ?? []), labels: uniq(r.descripteur_libelle ?? []) },
          noticeKind: [r.nature_libelle, r.procedure_libelle].filter(Boolean).join(" · ") || undefined,
        });
        if (r.dateparution && r.dateparution > maxDay) maxDay = r.dateparution;
      }
      if (res.results.length < page) break;
    }
    return { items, complete, cursor: complete ? maxDay : `${fromDay}|${offset}` };
  },
};
