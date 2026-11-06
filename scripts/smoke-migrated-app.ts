/** Runs the existing application readers against the migrated DB; never logs business rows or tokens. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { writeFile } from "node:fs/promises";
loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.NEW_MONGODB_URI) throw new Error("Verified destination is required.");
  // This process only: the active application is not switched by this verification script.
  process.env.MONGODB_URI = process.env.NEW_MONGODB_URI;
  process.env.DISABLE_AUTO_SEED = "true";
  mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
  const { connectToDatabase } = await import("../src/lib/db/connect");
  await connectToDatabase();
  const { User, Company } = await import("../src/models");
  const { toActor, loadSessionUser, isActiveSessionUser } = await import("../src/lib/auth/actor");
  const { signSession, verifySession } = await import("../src/lib/auth/token");
  const { listCompanies, companyQuerySchema, buildCompanyFilter } = await import("../src/features/companies/service");
  const { listOldCompanies } = await import("../src/features/established/service");
  const { listOpportunities } = await import("../src/features/opportunities/service");
  const { exportCompanies } = await import("../src/features/companies/registrations");
  const owner = await User.findOne({ role: "OWNER" }).lean<import("../src/models").UserDoc>();
  if (!owner) throw new Error("No existing Owner account was found.");
  const actor = toActor(owner);
  const companies = await listCompanies(actor, { country: "ALL", range: "all", pageSize: 5 });
  const established = await listOldCompanies(actor, { pageSize: 5 });
  const jobs = await listOpportunities(actor, { type: "HIRING", pageSize: 5 });
  const token = await signSession({ sub: actor.id, role: actor.role, sv: owner.sessionVersion ?? 0 });
  const sessionUser = await loadSessionUser(await verifySession(token));
  const sessionVerified = !!sessionUser && sessionUser.id === actor.id && isActiveSessionUser(sessionUser);
  if (!sessionVerified) throw new Error("Existing Owner session eligibility verification failed.");
  const sample = await Company.findOne({ isDemo: { $ne: true }, registrationDay: { $type: "string" }, $or: [{ eventType: "NEW_ENTITY" }, { eventType: { $exists: false } }, { eventType: null }] }).select("countryCode registrationDay").lean<{ countryCode: string; registrationDay: string }>();
  if (!sample) throw new Error("No suitable migrated daily records were found for export verification.");
  const query = { country: sample.countryCode, range: "custom", from: sample.registrationDay, to: sample.registrationDay };
  const expected = await Company.countDocuments(buildCompanyFilter(actor, companyQuerySchema.parse(query)));
  const exported = await exportCompanies(actor, query);
  if (!exported.rows || exported.truncated || exported.rows !== expected || !exported.csv.includes('"Company"')) throw new Error("Existing daily export verification failed.");
  const report = {
    at: new Date().toISOString(), companyList: { total: companies.total, pageRecords: companies.items.length },
    establishedList: { total: established.total, pageRecords: established.items.length },
    jobList: { total: jobs.total, pageRecords: jobs.items.length },
    existingOwnerJwtAndSessionVerified: sessionVerified, realPasswordLoginVerified: false,
    existingExcelCompatibleExport: { verified: true, records: exported.rows, matchedDatabaseRecords: expected, truncated: false },
    deletionEnabled: !!process.env.DAILY_BACKUP_DIR, autoSeedDisabled: true,
    notes: "Internal session signing/reading was tested without issuing a browser cookie or bypassing the login API. Original-password login still needs the user's private interactive input. Existing export produced only an in-memory CSV and its normal audit receipt.",
  };
  await writeFile("storage/backups/migration/application-smoke.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error("Application smoke verification failed. No password, browser token or business row was logged; no runtime switch was approved."); process.exitCode = 1; }).finally(() => mongoose.disconnect());
