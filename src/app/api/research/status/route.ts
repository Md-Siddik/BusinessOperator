import { route } from "@/lib/api/handler";
import { researchReport } from "@/features/research/reports";

/** Research queue, budget, provider spend and contact coverage by country × registration-age cohort. */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ actor }) => researchReport(actor));
