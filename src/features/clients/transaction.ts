import mongoose, { type ClientSession } from "mongoose";
import { AppError } from "@/lib/errors";

/** Tenant lifecycle writes must commit together; never fall back to partial deletion. */
export async function clientTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  try {
    return await mongoose.connection.transaction(work, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } catch (err) {
    if ((err as { code?: number }).code === 20) throw new AppError(503, "TRANSACTIONS_REQUIRED", "Client lifecycle changes require MongoDB replica-set or sharded-cluster transactions. Configure the database and retry.");
    throw err;
  }
}
