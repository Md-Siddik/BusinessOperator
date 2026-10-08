import { route } from "@/lib/api/handler";
import { searchCompanies } from "@/features/companies/service";

/** Global company search: name, registration number, email, phone, website, address. */
export const GET = route({ internal: true, permission: "companies.read" }, async ({ req, actor }) => {
  const items = await searchCompanies(actor, req.nextUrl.searchParams.get("q") ?? "");
  return {
    items: items.map((c) => ({
      id: String(c._id),
      name: c.companyName,
      registrationNumber: c.registrationNumber,
      countryCode: c.countryCode,
      registrationDay: c.registrationDay,
      city: c.city,
      email: c.email,
      phone: c.phone,
      website: c.website,
      isDemo: c.isDemo,
    })),
  };
});
