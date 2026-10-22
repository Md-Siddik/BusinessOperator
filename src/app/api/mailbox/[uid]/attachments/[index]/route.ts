import { route } from "@/lib/api/handler";
import { getMailAttachment } from "@/features/mailbox/service";

type P = { uid: string; index: string };

/** Download one attachment of a Client Mail message (Owner only; read live from Zoho, never stored). */
export const GET = route<P>({ ownerOnly: true }, async ({ actor, params }) => {
  const a = await getMailAttachment(actor, Number(params.uid), Number(params.index));
  const name = a.filename.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(a.content), {
    headers: {
      // Always a download, never rendered on our origin.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
