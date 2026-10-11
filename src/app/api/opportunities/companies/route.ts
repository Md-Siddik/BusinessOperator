import { route } from "@/lib/api/handler";
import { searchCompaniesForLink } from "@/features/opportunities/service";

/** Company lookup for linking an employer feed to Company Intelligence (owner only). */
export const GET = route({ ownerOnly: true }, async ({ req, actor }) => searchCompaniesForLink(actor, req.nextUrl.searchParams.get("q") ?? ""));
