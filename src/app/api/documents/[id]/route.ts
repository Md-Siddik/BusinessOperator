import { route } from "@/lib/api/handler";
import { fileResponse } from "@/lib/api/uploads";
import { getDocumentForDownload } from "@/features/clients/service";

/** Authorized download — organization access is checked before any bytes are read. */
export const GET = route<{ id: string }>({}, async ({ actor, params }) => {
  const { doc, data } = await getDocumentForDownload(actor, params.id);
  return fileResponse(data, doc.name, doc.mimeType);
});
