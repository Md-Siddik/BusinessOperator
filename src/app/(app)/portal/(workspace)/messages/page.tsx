import { Suspense } from "react";
import { requireClientPage } from "@/lib/auth/session";
import { toPlain } from "@/lib/utils";
import { getAvailability, listConversations } from "@/features/chat/service";
import { PageHeader } from "@/components/ui/data";
import { ChatWorkspace, type ConversationSummary } from "@/components/chat/chat-workspace";

export const metadata = { title: "Messages" };

export default async function PortalMessagesPage() {
  const actor = await requireClientPage();
  const [conversations, availability] = await Promise.all([listConversations(actor, {}), getAvailability()]);
  return (
    <div>
      <PageHeader eyebrow="Messages" title="Talk to the ExploreTechify team" description={`${availability.text}. Replies appear here instantly and you'll get a notification.`} />
      <Suspense>
        <ChatWorkspace mode="client" me={{ id: actor.id, name: actor.name }} initialConversations={toPlain(conversations) as unknown as ConversationSummary[]} availability={availability.text} />
      </Suspense>
    </div>
  );
}
