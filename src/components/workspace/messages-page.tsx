import { Suspense } from "react";
import { Types } from "mongoose";
import { requireWorkspacePage, type WorkspaceBase } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { toPlain } from "@/lib/utils";
import { Organization } from "@/models";
import { getAvailability, listConversations } from "@/features/chat/service";
import { listInternalUsers } from "@/features/crm/service";
import { PageHeader } from "@/components/ui/data";
import { ChatWorkspace, type ConversationSummary } from "@/components/chat/chat-workspace";

export type MessagesSearchParams = Promise<{ client?: string; new?: string }>;

/**
 * Inbox for the owner dashboard and the staff workspace.
 * ?client=<organizationId> shows one client's conversations; &new=1 opens a new message to that client.
 */
export async function MessagesPage({ base, searchParams }: { base: WorkspaceBase; searchParams?: MessagesSearchParams }) {
  const actor = await requireWorkspacePage(base, ["chat.manage", "conversations.assigned"]);
  const sp = (await searchParams) ?? {};
  const clientId = sp.client && Types.ObjectId.isValid(sp.client) ? sp.client : undefined;
  const [conversations, staff, orgs, availability] = await Promise.all([
    listConversations(actor, clientId ? { organizationId: clientId } : {}),
    listInternalUsers(),
    // Clients that can be messaged: active ones, and signed-up ones awaiting approval (they can chat already).
    Organization.find({ status: { $in: ["ACTIVE", "PENDING_APPROVAL"] } }).select("name status").sort({ name: 1 }).lean<{ _id: unknown; name: string; status: string }[]>(),
    getAvailability(),
  ]);
  const organizations = orgs.map((o) => ({ id: String(o._id), name: o.status === "PENDING_APPROVAL" ? `${o.name} (awaiting approval)` : o.name }));
  const client = clientId ? organizations.find((o) => o.id === clientId) : undefined;
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
          organizations={organizations}
          canAssign={can(actor, "chat.manage")}
          availability={availability.text}
          client={client}
          composeForClient={!!client && sp.new === "1"}
        />
      </Suspense>
    </div>
  );
}
