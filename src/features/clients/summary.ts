import "server-only";
import type { FilterQuery } from "mongoose";
import { Errors } from "@/lib/errors";
import { can, isInternal, type Actor } from "@/lib/permissions";
import { ContactRequest, Conversation, Organization, Project, User, type ConversationDoc, type OrganizationDoc, type UserDoc } from "@/models";
import { conversationAccessFilter, unreadConversationCount } from "@/features/chat/service";
import { ticketCounts } from "@/features/tickets/service";

/**
 * Client details for the owner dashboard and the staff workspace. Every figure is a
 * count of stored records, filtered by what the actor may see (permission-aware).
 */
export type ClientSummary = {
  canSeeClients: boolean;
  counts: {
    activeClients: number | null;
    pendingClients: number | null;
    waitingConversations: number;
    unreadConversations: number;
    openTickets: number;
    activeProjects: number | null;
    newInquiries: number | null;
  };
  recentClients: {
    id: string;
    name: string;
    status: string;
    countryCode?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    createdAt: Date;
    contact?: { name: string; email: string } | null;
  }[];
  latestConversations: { id: string; subject: string; organization: string; status: string; lastMessageAt: Date; waiting: boolean; preview?: string | null }[];
};

export async function getClientSummary(actor: Actor): Promise<ClientSummary> {
  if (!isInternal(actor)) throw Errors.forbidden();
  const canSeeClients = can(actor, "clients.manage");
  const convAccess = conversationAccessFilter(actor) as FilterQuery<ConversationDoc>;
  const [activeClients, pendingClients, waitingConversations, unreadConversations, openTickets, activeProjects, newInquiries, orgs, convs] = await Promise.all([
    canSeeClients ? Organization.countDocuments({ status: "ACTIVE", isDemo: { $ne: true } }) : Promise.resolve(null),
    canSeeClients ? Organization.countDocuments({ status: "PENDING_APPROVAL" }) : Promise.resolve(null),
    Conversation.countDocuments({ ...convAccess, lastMessageFromClient: true, status: { $ne: "CLOSED" } }),
    unreadConversationCount(actor),
    ticketCounts(actor),
    can(actor, "projects.manage") ? Project.countDocuments({ status: "ACTIVE" }) : Promise.resolve(null),
    canSeeClients ? ContactRequest.countDocuments({ status: "NEW" }) : Promise.resolve(null),
    canSeeClients ? Organization.find().sort({ createdAt: -1 }).limit(8).select("name status countryCode email phone website createdAt").lean<OrganizationDoc[]>() : Promise.resolve([]),
    Conversation.find(convAccess).sort({ lastMessageAt: -1 }).limit(6).populate("organizationId", "name").select("subject status lastMessageAt lastMessageFromClient lastMessagePreview organizationId").lean<(ConversationDoc & { organizationId: { name?: string } | null })[]>(),
  ]);
  // Primary contact per client (the first client user of the organization).
  const contacts = orgs.length ? await User.find({ organizationId: { $in: orgs.map((o) => o._id) }, role: "CLIENT" }).sort({ createdAt: 1 }).select("name email organizationId").lean<UserDoc[]>() : [];
  const contactByOrg = new Map<string, { name: string; email: string }>();
  for (const u of contacts) if (!contactByOrg.has(String(u.organizationId))) contactByOrg.set(String(u.organizationId), { name: u.name, email: u.email });

  return {
    canSeeClients,
    counts: { activeClients, pendingClients, waitingConversations, unreadConversations, openTickets, activeProjects, newInquiries },
    recentClients: orgs.map((o) => ({ id: String(o._id), name: o.name, status: o.status, countryCode: o.countryCode, email: o.email, phone: o.phone, website: o.website, createdAt: o.createdAt, contact: contactByOrg.get(String(o._id)) ?? null })),
    latestConversations: convs.map((c) => ({ id: String(c._id), subject: c.subject, organization: c.organizationId?.name ?? "Client", status: c.status, lastMessageAt: c.lastMessageAt, waiting: !!c.lastMessageFromClient && c.status !== "CLOSED", preview: c.lastMessagePreview })),
  };
}
