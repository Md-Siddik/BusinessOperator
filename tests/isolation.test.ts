import { beforeAll, describe, expect, it } from "vitest";
import { ClientDocument, Conversation, Message, Notification, Organization, type ConversationDoc } from "@/models";
import { getStorage } from "@/lib/storage";
import { createTicket, getTicket, listTickets, updateTicket, addTicketComment } from "@/features/tickets/service";
import { getProject, listProjects, saveProject } from "@/features/projects/service";
import { getDocumentForDownload, getOrganizationOverview, listDocuments, updateOrganization } from "@/features/clients/service";
import {
  canSeeConversationEvent,
  getConversation,
  getMessageAttachment,
  listConversations,
  markConversationRead,
  sendMessage,
  startConversation,
  unreadConversationCount,
  updateConversation,
} from "@/features/chat/service";
import { expectRejects, makeOrg, makeTenants, makeUser } from "./helpers";

let t: Awaited<ReturnType<typeof makeTenants>>;

beforeAll(async () => {
  t = await makeTenants();
});

describe("Organization isolation — Client A must never access Client B's data", () => {
  it("organization overview", async () => {
    await expect(getOrganizationOverview(t.clientA.actor, String(t.orgA._id))).resolves.toBeTruthy();
    await expectRejects(getOrganizationOverview(t.clientA.actor, String(t.orgB._id)), 404);
    await expectRejects(updateOrganization(t.clientA.actor, String(t.orgB._id), { name: "Hacked" }), 404);
  });

  it("tickets and requests (including IDOR by id)", async () => {
    const tb = await createTicket(t.clientB.actor, { kind: "TICKET", title: "B's ticket", description: "Private to B" });
    const listA = await listTickets(t.clientA.actor, {});
    expect(listA.items.some((x) => String(x._id) === String(tb._id))).toBe(false);
    await expectRejects(getTicket(t.clientA.actor, String(tb._id)), 404);
    await expectRejects(addTicketComment(t.clientA.actor, String(tb._id), { body: "hi" }), 404);
    await expectRejects(updateTicket(t.clientA.actor, String(tb._id), { status: "CLOSED" }), 404);
    // Client-supplied organizationId is ignored — tickets are always created in the client's own org.
    const ta = await createTicket(t.clientA.actor, { kind: "REQUEST", title: "Mine", description: "Request body", organizationId: String(t.orgB._id) });
    expect(String(ta.organizationId)).toBe(String(t.orgA._id));
  });

  it("internal ticket notes are never shown to clients", async () => {
    const tk = await createTicket(t.clientA.actor, { kind: "TICKET", title: "Notes", description: "Check notes" });
    await addTicketComment(t.owner.actor, String(tk._id), { body: "internal only", internal: true });
    await addTicketComment(t.owner.actor, String(tk._id), { body: "visible reply", internal: false });
    const asClient = await getTicket(t.clientA.actor, String(tk._id));
    expect(asClient.comments.map((c) => c.body)).toEqual(["visible reply"]);
    // Clients cannot create internal notes.
    await addTicketComment(t.clientA.actor, String(tk._id), { body: "sneaky", internal: true });
    const asOwner = await getTicket(t.owner.actor, String(tk._id));
    expect(asOwner.comments.find((c) => c.body === "sneaky")?.internal).toBe(false);
  });

  it("projects", async () => {
    const pb = await saveProject(t.owner.actor, null, { organizationId: String(t.orgB._id), name: "B project" });
    expect((await listProjects(t.clientA.actor)).items).toHaveLength(0);
    await expectRejects(getProject(t.clientA.actor, String(pb._id)), 404);
    await expectRejects(saveProject(t.clientA.actor, null, { organizationId: String(t.orgA._id), name: "x" }), 403);
  });

  it("documents and downloads", async () => {
    const key = await getStorage().save(Buffer.from("secret B"), "b.txt");
    const doc = await ClientDocument.create({ organizationId: t.orgB._id, name: "b.txt", fileKey: key, mimeType: "text/plain", size: 8 });
    const hidden = await ClientDocument.create({ organizationId: t.orgA._id, name: "internal.txt", fileKey: key, visibleToClient: false });
    expect((await listDocuments(t.clientA.actor, String(t.orgA._id))).some((d) => String(d._id) === String(hidden._id))).toBe(false);
    await expectRejects(listDocuments(t.clientA.actor, String(t.orgB._id)), 404);
    await expectRejects(getDocumentForDownload(t.clientA.actor, String(doc._id)), 404);
    await expectRejects(getDocumentForDownload(t.clientA.actor, String(hidden._id)), 404);
    const ok = await getDocumentForDownload(t.clientB.actor, String(doc._id));
    expect(ok.data.toString()).toBe("secret B");
    await getStorage().remove(key);
  });

  it("malformed and non-existent ids return 404, never 500", async () => {
    await expectRejects(getTicket(t.clientA.actor, "not-an-id"), 404);
    await expectRejects(getConversation(t.clientA.actor, "000000000000000000000000"), 404);
  });
});

describe("Chat security & behaviour", () => {
  let convB: string;
  let attachmentId: string;
  /** A staff member WITHOUT chat.manage (the owner can narrow staff permissions per user). */
  let limited: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    limited = await makeUser("STAFF", { permissions: ["tickets.manage"] });
  });

  it("clients start conversations only in their own organization", async () => {
    const r = await startConversation(t.clientB.actor, { subject: "Need help", topic: "WEBSITE", body: "Hello", organizationId: String(t.orgA._id) }, [
      { name: "brief.txt", mimeType: "text/plain", size: 5, data: Buffer.from("brief") },
    ]);
    convB = r.conversationId;
    const conv = await Conversation.findById(convB).lean<ConversationDoc>();
    expect(String(conv!.organizationId)).toBe(String(t.orgB._id));
    attachmentId = r.message.attachments[0]!._id;
  });

  it("Client A can never list, read, write to or download from Client B's conversations", async () => {
    expect((await listConversations(t.clientA.actor, {})).length).toBe(0);
    expect((await listConversations(t.clientA.actor, { q: "Hello" })).length).toBe(0);
    await expectRejects(getConversation(t.clientA.actor, convB), 404);
    await expectRejects(sendMessage(t.clientA.actor, convB, { body: "intrusion" }), 404);
    await expectRejects(markConversationRead(t.clientA.actor, convB), 404);
    await expectRejects(updateConversation(t.clientA.actor, convB, { status: "CLOSED" }), 404);
    await expectRejects(getMessageAttachment(t.clientA.actor, convB, attachmentId), 404);
    expect(await Message.countDocuments({ conversationId: convB, body: "intrusion" })).toBe(0);
  });

  it("staff without chat.manage only see conversations assigned to them", async () => {
    await expectRejects(getConversation(limited.actor, convB), 404);
    expect((await listConversations(limited.actor, {})).length).toBe(0);
    await expectRejects(updateConversation(limited.actor, convB, { assignedTo: limited.actor.id }), 404);
    await updateConversation(t.admin.actor, convB, { assignedTo: limited.actor.id });
    const visible = await listConversations(limited.actor, {});
    expect(visible.map((c) => String(c._id))).toEqual([convB]);
    // Assigned staff may change status but not reassign.
    await updateConversation(limited.actor, convB, { status: "IN_PROGRESS" });
    await expectRejects(updateConversation(limited.actor, convB, { assignedTo: t.admin.actor.id }), 403);
  });

  it("messages are created, delivered and marked read with unread counts", async () => {
    expect(await unreadConversationCount(t.owner.actor)).toBeGreaterThanOrEqual(1);
    await sendMessage(t.staff.actor, convB, { body: "Hi, we're on it" });
    expect(await unreadConversationCount(t.clientB.actor)).toBe(1);
    const thread = await getConversation(t.clientB.actor, convB);
    expect(thread.messages.map((m) => m.body)).toContain("Hi, we're on it");
    expect(await unreadConversationCount(t.clientB.actor)).toBe(0);
    const fromClient = thread.messages.find((m) => m.body === "Hello")!;
    expect(fromClient.readBy).toContain(t.staff.actor.id);
  });

  it("another user in the same organization shares conversations", async () => {
    const colleague = await makeUser("CLIENT", { organizationId: t.orgB._id, permissions: [] });
    expect((await listConversations(colleague.actor, {})).map((c) => String(c._id))).toContain(convB);
  });

  it("realtime events are filtered with the same rules", () => {
    const evt = { organizationId: String(t.orgB._id), assignedTo: limited.actor.id, participantIds: [t.clientB.actor.id] };
    expect(canSeeConversationEvent(t.clientB.actor, evt)).toBe(true);
    expect(canSeeConversationEvent(t.clientA.actor, evt)).toBe(false);
    expect(canSeeConversationEvent(limited.actor, evt)).toBe(true);
    expect(canSeeConversationEvent(limited.actor, { ...evt, assignedTo: null })).toBe(false);
    expect(canSeeConversationEvent(t.owner.actor, { ...evt, assignedTo: null })).toBe(true);
  });

  it("validates messages and attachments", async () => {
    await expectRejects(sendMessage(t.clientB.actor, convB, { body: "" }), 400);
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, mimeType: "text/plain", size: 1, data: Buffer.from("x") }));
    await expectRejects(sendMessage(t.clientB.actor, convB, { body: "files" }, six), 400);
  });
});

describe("Messaging individual clients", () => {
  /** The organization of a listed conversation (populated with its name). */
  const orgOf = (c: unknown) => String((c as { organizationId: { _id: unknown } }).organizationId._id);
  const notified = async (userId: string, conversationId: string) => Notification.countDocuments({ userId, type: "CHAT_MESSAGE", groupKey: `conv:${conversationId}` });

  it("the Owner messages one client: only that client sees it and is notified, and their reply reaches the Owner", async () => {
    const { conversationId } = await startConversation(t.owner.actor, { subject: "Your new website", topic: "WEBSITE", body: "Here is the first draft.", organizationId: String(t.orgA._id) });
    expect((await listConversations(t.clientA.actor, {})).map((c) => String(c._id))).toContain(conversationId);
    expect((await listConversations(t.clientB.actor, {})).map((c) => String(c._id))).not.toContain(conversationId);
    expect(await notified(t.clientA.actor.id, conversationId)).toBe(1);
    expect(await notified(t.clientB.actor.id, conversationId)).toBe(0);
    expect(await unreadConversationCount(t.clientA.actor)).toBeGreaterThanOrEqual(1);

    await sendMessage(t.clientA.actor, conversationId, { body: "Looks great, thanks!" });
    // Started by the Owner, so assigned to the Owner: the reply notifies them.
    expect(await notified(t.owner.actor.id, conversationId)).toBe(1);
    const thread = await getConversation(t.owner.actor, conversationId);
    expect(thread.messages.map((m) => m.body)).toEqual(["Here is the first draft.", "Looks great, thanks!"]);
  });

  it("the inbox can be filtered to one client — never widening anyone's access", async () => {
    const onlyA = await listConversations(t.owner.actor, { organizationId: String(t.orgA._id) });
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyA.every((c) => orgOf(c) === String(t.orgA._id))).toBe(true);
    // A client cannot use the filter to reach another organization.
    const tried = await listConversations(t.clientA.actor, { organizationId: String(t.orgB._id) });
    expect(tried.every((c) => orgOf(c) === String(t.orgA._id))).toBe(true);
    // Staff without chat.manage still see only what is assigned to them.
    const limited = await makeUser("STAFF", { permissions: ["tickets.manage"] });
    expect(await listConversations(limited.actor, { organizationId: String(t.orgA._id) })).toEqual([]);
  });

  it("clients awaiting approval can be messaged and are notified of replies", async () => {
    const org = await makeOrg("Pending Client AS", "PENDING_APPROVAL");
    const pending = await makeUser("CLIENT", { organizationId: org._id, permissions: [], status: "PENDING_APPROVAL" });
    const { conversationId } = await startConversation(pending.actor, { subject: "Question", body: "Can you build a booking page?" });
    await sendMessage(t.owner.actor, conversationId, { body: "Yes — happy to help." });
    expect(await notified(pending.actor.id, conversationId)).toBe(1);
    // The Owner can also start a conversation with them.
    await expect(startConversation(t.owner.actor, { subject: "Welcome", body: "Hello!", organizationId: String(org._id) })).resolves.toBeTruthy();
  });

  it("suspended clients cannot be messaged or notified", async () => {
    const org = await makeOrg("Suspended Client AS", "ACTIVE");
    const user = await makeUser("CLIENT", { organizationId: org._id, permissions: [] });
    const { conversationId } = await startConversation(user.actor, { subject: "Old thread", body: "Hello" });
    await Organization.updateOne({ _id: org._id }, { $set: { status: "SUSPENDED" } });
    await expectRejects(startConversation(t.owner.actor, { subject: "Hi", body: "Hello", organizationId: String(org._id) }), 400);
    await sendMessage(t.owner.actor, conversationId, { body: "A reply" });
    expect(await notified(user.actor.id, conversationId)).toBe(0);
  });
});
