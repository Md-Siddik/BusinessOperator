import { mongo } from "mongoose";

/** Atlas rejects writes once the cluster's storage quota is exhausted. */
export function isDatabaseCapacityError(error: unknown) {
  return error instanceof mongo.MongoServerError && error.code === 8000 && /\bspace quota\b/i.test(error.message);
}
