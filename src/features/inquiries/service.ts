import "server-only";
import { z } from "zod";
import { Types } from "mongoose";
import { ContactRequest, type ContactRequestDoc } from "@/models";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { parseObjectId } from "@/lib/validation";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";
import { escapeRegex } from "@/lib/utils";
import { sendTransactionalEmail } from "@/lib/email/transactional";
import { hashToken } from "@/lib/auth/password";
import { notifyInternal, notifyUsers } from "@/features/notifications/service";
import { audit } from "@/lib/audit";

export function canManageInquiries(actor: Actor) {
  return (actor.role === "OWNER" || actor.role === "ADMIN") && can(actor, "clients.manage");
}
export function inquiryFilter(actor: Actor): Record<string, unknown> {
  if (canManageInquiries(actor)) return {};
  if (actor.role !== "CLIENT") throw Errors.forbidden();
  // The API/page requires a verified session. Email ownership must match, even for linked records.
  return { email: actor.email, $or: [{ userId: actor.id }, { userId: null }] };
}
export async function listInquiries(actor: Actor, opts: { q?: string; status?: string; page?: number } = {}) {
  const filter = inquiryFilter(actor);
  if (opts.status) filter.status = z.enum(CONTACT_REQUEST_STATUSES).parse(opts.status);
  if (opts.q) filter.$and = [{ $or: ["name", "email", "message", "need", "company"].map((field) => ({ [field]: new RegExp(escapeRegex(opts.q!.slice(0, 200)), "i") })) }];
  const page = Math.max(1, Math.min(10000, Math.floor(opts.page || 1)));
  const [items, total, unread] = await Promise.all([
    ContactRequest.find(filter).select("-notes").sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).lean<ContactRequestDoc[]>(),
    ContactRequest.countDocuments(filter),
    ContactRequest.countDocuments({ ...inquiryFilter(actor), status: "NEW" }),
  ]);
  return { items, total, unread, page, pageCount: Math.ceil(total / 25) };
}
export async function getInquiry(actor: Actor, id: string) {
  const record = await ContactRequest.findOne({ ...inquiryFilter(actor), _id: parseObjectId(id) }).lean<ContactRequestDoc>();
  if (!record) throw Errors.notFound();
  if (!canManageInquiries(actor)) record.notes = undefined;
  return record;
}
const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("REPLY"), body: z.string().trim().min(1).max(10000) }),
  z.object({ kind: z.literal("QUOTATION"), body: z.string().trim().min(1).max(10000),
    amount: z.number().finite().min(0).max(100000000), currency: z.enum(["USD", "EUR", "GBP", "BDT", "NOK", "SEK", "DKK"]),
    scope: z.string().trim().min(1).max(5000), delivery: z.string().trim().min(1).max(200),
    paymentTerms: z.string().trim().min(1).max(2000), notes: z.string().trim().max(3000).optional() }),
]);
export async function respondToInquiry(actor: Actor, id: string, input: unknown) {
  if (!canManageInquiries(actor)) throw Errors.forbidden();
  const d = responseSchema.parse(input);
  const record = await getInquiry(actor, id);
  if (!record.emailVerifiedAt) throw Errors.badRequest("The client must verify this inquiry email before private replies can be sent.");
  const responseId = new Types.ObjectId();
  await ContactRequest.updateOne({ _id: record._id }, {
    $push: { responses: { _id: responseId, ...d, authorId: actor.id, emailStatus: "NOT_SENT", decision: "PENDING" } },
    $set: { status: d.kind === "QUOTATION" ? "QUOTATION_SENT" : "IN_DISCUSSION" },
  });
  const details = d.kind === "QUOTATION" ? "\n\nAmount: " + d.amount + " " + d.currency + "\nScope: " + d.scope + "\nDelivery: " + d.delivery + "\nPayment terms: " + d.paymentTerms + "\nNotes: " + (d.notes || "") : "";
  const result = await sendTransactionalEmail({ to: record.email, toName: record.name,
    subject: d.kind === "QUOTATION" ? "Your project quotation" : "Reply to your project inquiry",
    text: d.body + details + "\n\nSign in to your client dashboard to view your inquiry and respond." });
  await ContactRequest.updateOne({ _id: record._id, "responses._id": responseId }, { $set: { "responses.$.emailStatus": result.accepted ? "ACCEPTED" : "FAILED" } });
  if (record.userId) await notifyUsers([String(record.userId)], { type: "REPLY", title: "New inquiry response", link: "/portal/inquiries/" + id });
  await audit(actor, "inquiry.responded", { entityType: "ContactRequest", entityId: id, metadata: { kind: d.kind, emailAccepted: result.accepted } });
  return { saved: true, emailAccepted: result.accepted };
}
export async function updateInquiryStatus(actor: Actor, id: string, input: unknown) {
  if (!canManageInquiries(actor)) throw Errors.forbidden();
  const { status } = z.object({ status: z.enum(CONTACT_REQUEST_STATUSES) }).parse(input);
  const record = await getInquiry(actor, id);
  await ContactRequest.updateOne({ _id: record._id }, { $set: { status } });
  await audit(actor, "inquiry.status_changed", { entityType: "ContactRequest", entityId: id, metadata: { status } });
  return { ok: true };
}
export async function clientInquiryAction(actor: Actor, id: string, input: unknown) {
  if (actor.role !== "CLIENT") throw Errors.forbidden();
  const d = z.object({ responseId: z.string().optional(), decision: z.enum(["ACCEPTED", "REJECTED"]).optional(), body: z.string().trim().min(1).max(10000).optional() }).parse(input);
  const record = await getInquiry(actor, id);
  if (d.responseId && d.decision) {
    const result = await ContactRequest.updateOne({ _id: record._id, responses: { $elemMatch: { _id: parseObjectId(d.responseId), kind: "QUOTATION", decision: "PENDING" } } },
      { $set: { "responses.$.decision": d.decision, userId: actor.id, emailVerifiedAt: new Date(), status: d.decision } });
    if (!result.modifiedCount) throw Errors.conflict("This quotation has already been answered or is unavailable.");
  } else if (d.body) {
    await ContactRequest.updateOne({ _id: record._id }, { $push: { responses: { authorId: actor.id, kind: "CLIENT_REPLY", body: d.body } }, $set: { userId: actor.id, emailVerifiedAt: new Date(), status: "IN_DISCUSSION" } });
  } else throw Errors.badRequest("Choose a quotation decision or write a reply.");
  await notifyInternal("clients.manage", { type: "CLIENT_REQUEST", title: "Client responded to an inquiry", link: "/dashboard/inquiries/" + id });
  await audit(actor, "inquiry.client_responded", { entityType: "ContactRequest", entityId: id });
  return { ok: true };
}
export async function verifyInquiryEmail(input: unknown) {
  const { id, token } = z.object({ id: z.string(), token: z.string().min(20).max(200) }).parse(input);
  const record = await ContactRequest.findOneAndUpdate({ _id: parseObjectId(id), verificationTokenHash: hashToken(token), verificationExpiresAt: { $gt: new Date() } },
    { $set: { emailVerifiedAt: new Date() }, $unset: { verificationTokenHash: 1, verificationExpiresAt: 1 } });
  if (!record) throw Errors.badRequest("This verification link is invalid or expired.");
  return { ok: true };
}
