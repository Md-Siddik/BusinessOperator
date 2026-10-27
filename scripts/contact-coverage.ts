/**
 * Read-only contact coverage per country (aggregation only — nothing is written).
 *   npm run coverage:contacts
 * Prints, per country: companies, business email / phone / website / contact person, direct
 * contact, verified contact, Contact Status breakdown and Company Type breakdown.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function main() {
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { Company } = await import("../src/models");
  const { CONTACT_STATUSES, contactStatusFilter } = await import("../src/lib/company-fields");
  await connectToDatabase();
  const nonEmpty = (f: string) => ({ $cond: [{ $gt: [{ $strLenCP: { $ifNull: [`$${f}`, ""] } }, 0] }, 1, 0] });
  const statusBranches = CONTACT_STATUSES.map((s) => ({ s, f: contactStatusFilter(s) }));
  const rows = await Company.aggregate<Record<string, number | string>>([
    { $match: { isDemo: { $ne: true } } },
    {
      $group: {
        _id: "$countryCode",
        companies: { $sum: 1 },
        email: { $sum: nonEmpty("email") },
        phone: { $sum: { $max: [nonEmpty("phone"), nonEmpty("mobile")] } },
        website: { $sum: nonEmpty("website") },
        person: { $sum: nonEmpty("contactPerson.name") },
        direct: { $sum: { $cond: ["$directContact.has", 1, 0] } },
        startup: { $sum: { $cond: [{ $eq: ["$companyType.value", "STARTUP"] }, 1, 0] } },
        established: { $sum: { $cond: [{ $eq: ["$companyType.value", "ESTABLISHED"] }, 1, 0] } },
      },
    },
    { $sort: { companies: -1 } },
  ]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  console.info("Country  Companies  Email  Phone  Website  Person  Direct  Startup  Established");
  for (const r of rows) {
    const n = r.companies as number;
    console.info(`${String(r._id).padEnd(8)} ${String(n).padStart(9)}  ${pct(r.email as number, n).padStart(5)}  ${pct(r.phone as number, n).padStart(5)}  ${pct(r.website as number, n).padStart(7)}  ${pct(r.person as number, n).padStart(6)}  ${pct(r.direct as number, n).padStart(6)}  ${String(r.startup).padStart(7)}  ${String(r.established).padStart(11)}`);
  }
  console.info("\nContact Status (all countries):");
  for (const { s, f } of statusBranches) console.info(`  ${s.padEnd(24)} ${await Company.countDocuments({ isDemo: { $ne: true }, ...f })}`);
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
