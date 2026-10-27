/**
 * Established-company collection from the command line (same engine as the scheduler).
 *   npm run registry:established -- --probe [NO FI …]   → live check against the official APIs, NO database writes
 *   npm run registry:established -- NO US                → collect for these countries now (writes to MONGODB_URI)
 *   npm run registry:established -- NO --days 5          → more historical days in one run
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.env.DISABLE_AUTO_SEED = "true";
process.env.REGISTRY_SCHEDULER = "off";

async function probe(countries: string[]) {
  const { COUNTRIES } = await import("../src/config/countries");
  const { establishedProviderFor, selectEstablished } = await import("../src/features/registry/established");
  const { addDays, todayIn } = await import("../src/lib/dates/country-time");
  for (const c of COUNTRIES) {
    if (countries.length && !countries.includes(c.code)) continue;
    const { provider, reason } = establishedProviderFor(c.code);
    if (!provider || reason) {
      console.info(`${c.flag} ${c.name}: not collected — ${reason}`);
      continue;
    }
    let day = addDays(todayIn(c.timezone), -Math.round(5 * 365.25) - 3);
    // Registries register on working days: probe the nearest weekday.
    while ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) day = addDays(day, -1);
    try {
      const started = Date.now();
      const batch = await provider.getRegistrations!(day, day, { limit: 200, signal: AbortSignal.timeout(120_000) });
      const kept = selectEstablished(batch.companies);
      const wrongDay = batch.companies.filter((x) => x.registration.registrationDay !== day).length;
      const n = (f: (x: (typeof kept)[number]) => unknown) => kept.filter(f).length;
      console.info(`${c.flag} ${c.name} (${provider.id}) · registered ${day}: ${batch.companies.length} fetched (source total ${batch.total ?? "?"}) in ${Date.now() - started} ms → ${kept.length} active & established${wrongDay ? ` · ⚠ ${wrongDay} with another registration day` : ""}`);
      console.info(`   of those: email ${n((x) => x.contact.email)} · phone ${n((x) => x.contact.phone)} · website ${n((x) => x.contact.website)} · employees ${n((x) => x.employees !== undefined)}`);
      const s = kept[0];
      if (s) console.info(`   sample: ${s.identity.name} (${s.identity.registrationNumber}) status=${s.registration.status ?? "—"} employees=${s.employees ?? "—"}`);
    } catch (err) {
      console.error(`${c.flag} ${c.name}: ❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 2;
  const countries = args.filter((a, i) => !a.startsWith("--") && i !== daysIdx + 1).map((a) => a.toUpperCase());
  if (args.includes("--probe")) return probe(countries);
  const { connectToDatabase, disconnectFromDatabase } = await import("../src/lib/db/connect");
  const { ensureCountries } = await import("../src/features/countries/service");
  const { collectEstablished } = await import("../src/features/registry/established");
  await connectToDatabase();
  await ensureCountries();
  const res = await collectEstablished({ countries, days, minHours: 0, log: (m) => console.info(m) });
  console.info(JSON.stringify(res, null, 2));
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
