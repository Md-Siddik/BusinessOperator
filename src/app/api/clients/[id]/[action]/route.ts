import { z } from "zod";
import { readJson, route } from "@/lib/api/handler";
import { Errors } from "@/lib/errors";
import { readUploads } from "@/lib/api/uploads";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { createClientUser, listDocuments, setOrganizationStatus, uploadDocument, upsertClientService } from "@/features/clients/service";

type P = { id: string; action: string };

export const GET = route<P>({}, async ({ actor, params }) => {
  if (params.action === "documents") return listDocuments(actor, params.id);
  throw Errors.notFound();
});

/** Client admin actions: status (approve/suspend), users, services, documents. */
export const POST = route<P>({}, async ({ req, actor, params, ip }) => {
  switch (params.action) {
    case "status": {
      const { status } = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(await readJson(req));
      await setOrganizationStatus(actor, params.id, status);
      return { ok: true };
    }
    case "users":
      return createClientUser(actor, params.id, await readJson(req));
    case "services": {
      const body = (await readJson(req)) as { serviceId?: string };
      await upsertClientService(actor, params.id, body.serviceId ?? null, body);
      return { ok: true };
    }
    case "documents": {
      enforceRateLimit(RATE_LIMITS.upload, ip);
      const form = await req.formData();
      const [file] = await readUploads(form, "file");
      if (!file) throw Errors.badRequest("Choose a file to upload.");
      return uploadDocument(actor, params.id, file, { category: String(form.get("category") ?? ""), visibleToClient: form.get("visibleToClient") !== "false" });
    }
    default:
      throw Errors.notFound();
  }
});
