import { databaseFailureCategory } from "@/lib/db/errors";

/** Excludes messages, stacks, URLs, query values and record contents. */
export function safeFailure(error: unknown) {
  const e = error as { name?: unknown; code?: unknown; status?: unknown; cause?: { code?: unknown } } | null;
  const token = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_]{1,64}$/.test(v) ? v : undefined;
  return {
    category: (databaseFailureCategory(error) ?? (e?.name === "DatabaseUnavailableError" ? "database_configuration" : "operation_failed")) as string,
    errorType: token(e?.name),
    errorCode: typeof e?.code === "number" ? e.code : token(e?.code),
    causeCode: token(e?.cause?.code),
    upstreamStatus: typeof e?.status === "number" ? e.status : undefined,
  };
}

export async function syncStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try { return await operation(); }
  catch (error) {
    console.error("[registry.sync]", { stage, durationMs: Date.now() - started, ...safeFailure(error) });
    throw error;
  }
}
