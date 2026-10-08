import { route } from "@/lib/api/handler";
import { fileResponse } from "@/lib/api/uploads";
import { getTicketAttachment } from "@/features/tickets/service";

export const GET = route<{ id: string; attachmentId: string }>({}, async ({ actor, params }) => {
  const { attachment, data } = await getTicketAttachment(actor, params.id, params.attachmentId);
  return fileResponse(data, attachment.name, attachment.mimeType);
});
