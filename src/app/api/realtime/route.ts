import { connectToDatabase } from "@/lib/db/connect";
import { getActor } from "@/lib/auth/session";
import { channels, getRealtime, type RealtimeEvent } from "@/lib/realtime";
import { can, isClient, isInternal } from "@/lib/permissions";
import { canSeeConversationEvent } from "@/features/chat/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events stream for the signed-in user. Each event is filtered
 * against the same access rules as the REST API before it is sent.
 */
export async function GET(req: Request) {
  await connectToDatabase();
  const actor = await getActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });

  const rt = getRealtime();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RealtimeEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onConversationEvent = (event: RealtimeEvent) => {
        if (event.type === "notification" || event.type === "intel.updated") return;
        if (canSeeConversationEvent(actor, { organizationId: event.organizationId, assignedTo: "assignedTo" in event ? event.assignedTo : null, participantIds: "participantIds" in event ? event.participantIds : [] })) send(event);
      };
      const unsubs = [
        rt.subscribe(channels.user(actor.id), send),
        isClient(actor) ? rt.subscribe(channels.organization(actor.organizationId!), onConversationEvent) : rt.subscribe(channels.internal, onConversationEvent),
        // Company-intelligence events never reach clients.
        ...(isInternal(actor) && can(actor, "companies.read") ? [rt.subscribe(channels.intel, send)] : []),
      ];
      controller.enqueue(encoder.encode(`retry: 5000\n: connected\n\n`));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubs.forEach((u) => u());
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
