/** Read-only credential/role/TLS review; never prints usernames, passwords or URIs. */
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { writeFile, mkdir } from "node:fs/promises";
import { configureMongoDns, hasExplicitMongoDatabase } from "../src/lib/db/configuration";

loadEnvConfig(process.cwd());
async function main() {
  configureMongoDns();
  const uri = process.env.MONGODB_URI;
  if (!uri || !hasExplicitMongoDatabase(uri)) throw new Error("An explicit database URI is required.");
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000, timeoutMS: 15000 });
  try {
    await client.connect();
    const report: Record<string, unknown> = {
      at: new Date().toISOString(), scope: "Configured local credential; equivalence to Vercel's sensitive production credential is unverified.", database: client.db().databaseName,
      pingSucceeded: (await client.db().command({ ping: 1 })).ok === 1,
      tlsEnabled: client.options.tls === true,
      certificateValidationDisabled: client.options.tlsAllowInvalidCertificates === true,
      hostnameValidationDisabled: client.options.tlsAllowInvalidHostnames === true,
      credentialsPresent: !!client.options.credentials?.username && !!client.options.credentials?.password,
      passwordAtLeast32Characters: (client.options.credentials?.password?.length ?? 0) >= 32,
      passwordRandomnessVerified: false,
      localSessionSecretAtLeast32Characters: (process.env.AUTH_SECRET?.length ?? 0) >= 32,
      databaseWrites: 0,
    };
    try {
      const status = await client.db("admin").command({ connectionStatus: 1, showPrivileges: false });
      const roles = (status.authInfo?.authenticatedUserRoles ?? []) as { role: string; db: string }[];
      report.authenticatedRoleCount = roles.length;
      report.roles = roles.map(({ role, db }) => ({ role, database: db }));
      report.broadAdministrativeRolePresent = roles.some(({ role }) => /^(atlasAdmin|root|readWriteAnyDatabase|dbAdminAnyDatabase|userAdminAnyDatabase)$/.test(role));
      report.rolesAvailable = true;
    } catch (error) {
      report.rolesAvailable = false;
      report.roleInspectionErrorCode = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : undefined;
    }
    await mkdir("storage/backups/storage-audit", { recursive: true });
    await writeFile("storage/backups/storage-audit/security-audit.json", JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.close(); }
}
main().catch(error => { console.error("Read-only security audit failed:", typeof error.code === "number" ? error.code : error.name); process.exitCode = 1; });
