/** Read-only identity/dependency audit and proposed reset inventory. No delete/write commands. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { mkdir, writeFile } from "node:fs/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";
import { fingerprint } from "./lib/selective-migration";

loadEnvConfig(process.cwd());
const preserve = new Set(["users", "User", "organizations", "deletedidentities", "authratelimits", "systemsettings", "clientdeletions", "suppressionentries", "auditlogs", "counters"]);
const regenerate = new Set(["companies", "contacts", "established_companies", "jobs", "registrysyncs", "dailyregistrationsnapshots", "inboxitems", "checkpoints", "providerusages", "lookupcaches", "opportunityevents", "opportunitysyncruns", "webvisitors", "websessions", "webpageviews", "webeventkeys", "webconversions", "webanalyticsdailies"]);
// Authenticated workspace data and custom configuration are not known to be
// regenerable. List them explicitly rather than silently classifying them as cache.
const review = new Set(["crmactivities", "followups", "websiteaudits", "emailtemplates", "emailcampaigns", "emailmessages", "clientservices", "projects", "projecttasks", "supporttickets", "clientdocuments", "documents", "conversations", "messages", "notifications", "translations", "casestudies", "contactrequests", "servicepackages", "quotations", "opportunityfeeds", "services", "leadassignments", "countries", "opportunities"]);

async function main() {
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri || !hasExplicitMongoDatabase(uri)) throw new Error("An explicit MONGODB_URI database is required.");
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
  try {
    await client.connect();
    const db = client.db();
    const infos = await db.listCollections().toArray();
    if (infos.some(info => info.type !== "collection" || ![...preserve, ...regenerate, ...review].includes(info.name))) throw new Error("Unclassified database objects require manual review.");
    const users = await db.collection("users").find({}, { projection: { _id: 1, role: 1, status: 1, organizationId: 1, emailVerifiedAt: 1, passwordHash: 1 } }).toArray();
    const orgs = await db.collection("organizations").find({}).toArray();
    const orgById = new Map(orgs.map(org => [String(org._id), org]));
    const checks = {
      userCount: users.length,
      roles: Object.fromEntries([...new Set(users.map(user => String(user.role)))].map(role => [role, users.filter(user => user.role === role).length])),
      missingPasswordHashes: users.filter(user => typeof user.passwordHash !== "string" || !user.passwordHash).length,
      malformedPasswordHashes: users.filter(user => user.passwordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.passwordHash)).length,
      unverifiedUsers: users.filter(user => !user.emailVerifiedAt).length,
      clientUsers: users.filter(user => user.role === "CLIENT").length,
      clientsWithMissingOrganizations: users.filter(user => user.role === "CLIENT" && !orgById.has(String(user.organizationId))).length,
      activeClientsWithInactiveOrganizations: users.filter(user => user.role === "CLIENT" && user.status === "ACTIVE" && orgById.get(String(user.organizationId))?.status !== "ACTIVE").length,
    };
    const entries = [];
    const protectedFingerprints: Record<string, unknown> = {};
    for (const info of infos) {
      const stats = await db.command({ collStats: info.name, scale: 1 });
      const action = preserve.has(info.name) ? "PRESERVE_ALL" : regenerate.has(info.name) ? "REGENERABLE_CANDIDATE" : "EXPLICIT_CONTENT_REVIEW";
      entries.push({ collection: info.name, count: stats.count, dataBytes: stats.size, indexBytes: stats.totalIndexSize, action });
      if (preserve.has(info.name)) protectedFingerprints[info.name] = await fingerprint(db, info.name);
    }
    entries.sort((a, b) => a.collection.localeCompare(b.collection));
    const referencedCompanies = orgs.map(org => org.companyId).filter(Boolean);
    const sample = [];
    for (const info of await client.db("sample_mflix").listCollections().toArray()) {
      if (info.type !== "collection") throw new Error("Unexpected sample database object.");
      const stats = await client.db("sample_mflix").command({ collStats: info.name, scale: 1 });
      sample.push({ collection: info.name, count: stats.count, dataAndIndexBytes: stats.size + stats.totalIndexSize });
    }
    const report = {
      at: new Date().toISOString(), database: db.databaseName, productionConnectionVerified: false, storageCauseConfirmed: false, deletionApproved: false, databaseWrites: 0,
      identityChecks: checks, protectedFingerprints, collections: entries,
      preservedOrganizationCompanyReferences: referencedCompanies.length,
      preservationRule: "Preserve all identity/security collections and every company/contact dependency of any retained workspace record. Content-review collections are not approved for deletion.",
      sampleDatabase: { database: "sample_mflix", collections: sample, action: "REVIEW_THEN_DROP_ONLY_IF_CONFIRMED_UNUSED", warning: "Includes 185 sample users and one sample session; user must confirm these are disposable sample identities, not real accounts or another application's data." },
      executionGates: ["Confirm the deployed MongoDB cluster/database", "Obtain current production error evidence", "Verify a complete backup against the actual cleanup target", "Resolve custom-content and retained-reference scope", "Pause relevant writers and regenerate exact candidate IDs/counts", "Obtain final approval for the exact plan"],
    };
    await mkdir("storage/backups/storage-audit", { recursive: true });
    await writeFile("storage/backups/storage-audit/auth-cleanup-audit.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...report, protectedFingerprints: "Saved locally; no identity documents or credentials printed." }, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Authentication cleanup audit failed:", error.code ?? error.name); process.exitCode = 1; });
