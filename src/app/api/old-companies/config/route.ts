import { readJson, route } from "@/lib/api/handler";
import { getEstablishedConfig, setEstablishedConfig } from "@/features/established/config";

/** Old company Intelligence age threshold: read (companies.read), change (Owner only): { minAgeYears }. */
export const GET = route({ internal: true, permission: "companies.read" }, async () => getEstablishedConfig());
export const PUT = route({ ownerOnly: true }, async ({ req, actor }) => setEstablishedConfig(actor, await readJson(req)));
