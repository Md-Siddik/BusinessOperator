/**
 * Live verification of the configured registry providers (no database needed).
 *   npm run registry:verify            → every country with a connected feed
 *   npm run registry:verify -- NO FI   → selected countries
 *
 * For each provider: API responds → records parse → name / registration number /
 * registration date present → registration day equals the requested local day →
 * contact fields reported as the source returns them → source URL present.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { COUNTRIES } = await import("../src/config/countries");
  const { getRegistryProvider } = await import("../src/features/registry/providers");
  const { todayIn, addDays } = await import("../src/lib/dates/country-time");
  const only = process.argv.slice(2).map((a) => a.toUpperCase());
  let failures = 0;

  for (const c of COUNTRIES) {
    if (only.length && !only.includes(c.code)) continue;
    const p = getRegistryProvider(c.defaultProviderId);
    if (!p) continue;
    const head = `${c.flag} ${c.name} — ${p.sourceName} (${p.freshness})`;
    if (!p.capabilities.supportsDailyRegistrations || !p.getRegistrations) {
      console.info(`${head}\n   ⚪ no daily registration feed connected — ${p.limitations ?? ""}\n`);
      continue;
    }
    if (!p.isConfigured()) {
      console.info(`${head}\n   🔑 credentials required: ${p.requiredEnv.join(", ")}\n`);
      continue;
    }
    const status = await p.checkStatus();
    const today = todayIn(c.timezone);
    // Use yesterday as well: early in the morning "today" can legitimately be empty.
    for (const day of [today, addDays(today, -1)]) {
      try {
        const started = Date.now();
        const batch = await p.getRegistrations(day, day, { limit: 2000 });
        const list = batch.companies;
        const wrongDay = list.filter((x) => x.registration.registrationDay !== day);
        const missingCore = list.filter((x) => !x.identity.name || !x.identity.registrationNumber || !x.registration.registrationDay);
        const n = (f: (x: (typeof list)[number]) => unknown) => list.filter(f).length;
        console.info(`${head} · ${day} (${c.timezone})`);
        console.info(`   status: ${status.state}${status.message ? ` (${status.message})` : ""} · ${list.length} companies (source total ${batch.total ?? "?"}) in ${Date.now() - started} ms`);
        console.info(`   email ${n((x) => x.contact.email)} · phone ${n((x) => x.contact.phone)} · mobile ${n((x) => x.contact.mobile)} · website ${n((x) => x.contact.website)} · address ${n((x) => x.address.business?.street || x.address.business?.city)} · source URL ${n((x) => x.source.url)}`);
        if (wrongDay.length) {
          failures++;
          console.error(`   ❌ ${wrongDay.length} records have a different registration day (e.g. ${wrongDay[0]!.registration.registrationDay})`);
        }
        if (missingCore.length) {
          failures++;
          console.error(`   ❌ ${missingCore.length} records lack name / registration number / registration date`);
        }
        const sample = list.find((x) => x.contact.email || x.contact.phone || x.contact.mobile) ?? list[0];
        if (sample) {
          console.info(`   sample: ${sample.identity.name} (${sample.identity.registrationNumber}) registered ${sample.registration.registrationDay}`);
          console.info(`           email=${sample.contact.email ?? "—"} phone=${sample.contact.phone ?? "—"} mobile=${sample.contact.mobile ?? "—"} website=${sample.contact.website ?? "—"}`);
          console.info(`           ${sample.source.url ?? "no source URL"}`);
        }
        if (!wrongDay.length && !missingCore.length) console.info("   ✅ ok");
      } catch (e) {
        failures++;
        console.error(`${head} · ${day}\n   ❌ ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.info("");
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
