import { route } from "@/lib/api/handler";
import { listCountries } from "@/features/countries/service";

export const GET = route({ internal: true }, async () => listCountries());
