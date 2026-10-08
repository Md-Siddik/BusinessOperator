import { route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { parseObjectId } from "@/lib/validation";
import { RegistrySync, type RegistrySyncDoc } from "@/models";

type P = { id: string };

/** Progress / result of one sync run. */
export const GET = route<P>({ internal: true, permission: "companies.read" }, async ({ params }) => {
  const run = await RegistrySync.findById(parseObjectId(params.id)).lean<RegistrySyncDoc>();
  if (!run) throw Errors.notFound();
  return {
    id: String(run._id),
    countryCode: run.countryCode,
    status: run.status,
    progress: run.progress,
    from: run.rangeFrom,
    to: run.rangeTo,
    fetched: run.fetched,
    imported: run.imported,
    updated: run.updated,
    skipped: run.skipped,
    failed: run.failed,
    durationMs: run.durationMs,
    errors: run.errorLog?.slice(0, 5) ?? [],
    finishedAt: run.finishedAt,
  };
});
