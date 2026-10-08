import { route } from "@/lib/api/handler";
import { checkProviderStatus } from "@/features/countries/service";

type P = { code: string };

/** Live reachability check of a country's registry provider. */
export const POST = route<P>({ internal: true, permission: "registry.sync" }, async ({ actor, params }) => checkProviderStatus(actor, params.code));
