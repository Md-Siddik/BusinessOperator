import { Suspense } from "react";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { toPlain } from "@/lib/utils";
import { Organization } from "@/models";
import { getAvailability, listConversations } from "@/features/chat/service";
import { listInternalUsers } from "@/features/crm/service";
import { PageHeader } from "@/components/ui/data";
import { ChatWorkspace, type ConversationSummary } from "@/components/chat/chat-workspace";

export async function MessagesPage({ base }: { base: WorkspaceBase }) {
  const actor = await requireWorkspacePage(base);
  const [conversations, staff, orgs, availability] = await Promise.all([
    listConversations(actor, {}),
    listInternalUsers(),
    Organization.find({ status: "ACTIVE" }).select("name").sort({ name: 1 }).lean<{ _id: unknown; name: string }[]>(),
    getAvailability(),
  ]);
  return (
    <div>
      <PageHeader
        eyebrow="Client communication"
        title="Messages"
        description={can(actor, "chat.manage") ? "All client conversations. Updates arrive in real time." : "Conversations assigned to you or that you take part in."}
      />
      <Suspense>
        <ChatWorkspace
          mode="internal"
          me={{ id: actor.id, name: actor.name }}
          initialConversations={toPlain(conversations) as unknown as ConversationSummary[]}
          staff={staff.map((s) => ({ id: String(s._id), name: s.name }))}
          organizations={orgs.map((o) => ({ id: String(o._id), name: o.name }))}
          canAssign={can(actor, "chat.manage")}
          availability={availability.text}
        />
      </Suspense>
    </div>
  );
}
