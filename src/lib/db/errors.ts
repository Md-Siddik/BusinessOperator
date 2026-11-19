import { mongo } from "mongoose";

/** Atlas rejects writes once the cluster's storage quota is exhausted. */
export function isDatabaseCapacityError(error: unknown) {
  return error instanceof mongo.MongoServerError && error.code === 8000 && /\bspace quota\b/i.test(error.message);
}

/**
 * Driver errors raised when no MongoDB server can be reached. A host missing from the
 * Atlas IP Access List surfaces as a server-selection timeout (the TLS/TCP handshake
 * is refused), not as an authentication error.
 */
const NETWORK_ERROR_NAMES = new Set([
  "MongooseServerSelectionError",
  "MongoServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoTopologyClosedError",
  "MongoNotConnectedError",
]);

/** MongoDB `AuthenticationFailed`: wrong database username/password in MONGODB_URI. */
const AUTHENTICATION_FAILED = 18;

export type DatabaseFailureCategory = "database_capacity" | "database_network" | "database_authentication";

/** Sanitised category for database infrastructure failures; undefined for everything else. */
export function databaseFailureCategory(error: unknown): DatabaseFailureCategory | undefined {
  if (isDatabaseCapacityError(error)) return "database_capacity";
  const e = error as { name?: unknown; code?: unknown } | null;
  if (typeof e?.name === "string" && NETWORK_ERROR_NAMES.has(e.name)) return "database_network";
  if (error instanceof mongo.MongoServerError && error.code === AUTHENTICATION_FAILED) return "database_authentication";
  return undefined;
}
