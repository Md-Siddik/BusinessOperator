import { route } from "@/lib/api/handler";
import { getCountryCoverage } from "@/features/opportunities/service";

export const GET = route({ ownerOnly: true }, async ({ actor }) => getCountryCoverage(actor));
