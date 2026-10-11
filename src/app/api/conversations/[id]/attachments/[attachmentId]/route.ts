import { route } from "@/lib/api/handler";
import { fileResponse } from "@/lib/api/uploads";
import { getMessageAttachment } from "@/features/chat/service";

/** Attachment download authorized through the conversation — never by attachment id alone. */
export const GET = route<{ id: string; attachmentId: string }>({ allowPendingClient: true }, async ({ actor, params }) => {
  const { attachment, data } = await getMessageAttachment(actor, params.id, params.attachmentId);
  return fileResponse(data, attachment.name, attachment.mimeType);
});
