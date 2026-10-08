import { route } from "@/lib/api/handler";
import { unreadConversationCount } from "@/features/chat/service";
import { unreadNotificationCount } from "@/features/notifications/service";

/** Badge counts: conversations with unread messages + unread notifications. */
export const GET = route({}, async ({ actor }) => ({ messages: await unreadConversationCount(actor), notifications: await unreadNotificationCount(actor.id) }));
