import { Schema, type InferSchemaType } from "mongoose";
import { CONVERSATION_STATUSES, CONVERSATION_TOPICS, PRIORITIES } from "@/lib/constants";
import { ROLES } from "@/lib/permissions";
import { attachmentSchema } from "./SupportTicket";
import { defineModel, ObjectId, type Id } from "./_helpers";

/** ConversationParticipant — embedded; a conversation has few participants. */
const participantSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    role: { type: String, enum: ROLES, required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    topic: { type: String, enum: CONVERSATION_TOPICS, default: "GENERAL" },
    status: { type: String, enum: CONVERSATION_STATUSES, default: "OPEN" },
    priority: { type: String, enum: PRIORITIES, default: "NORMAL" },
    assignedTo: { type: ObjectId, ref: "User" },
    participants: { type: [participantSchema], default: [] },
    createdBy: { type: ObjectId, ref: "User", required: true },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: String,
    lastMessageSenderId: { type: ObjectId, ref: "User" },
    lastMessageFromClient: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ organizationId: 1, lastMessageAt: -1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ assignedTo: 1, lastMessageAt: -1 });
conversationSchema.index({ "participants.userId": 1 });
conversationSchema.index({ status: 1, lastMessageAt: -1 });

export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Id; createdAt: Date; updatedAt: Date };
export const Conversation = defineModel("Conversation", conversationSchema);

/** Message — MessageAttachment entries are embedded (access is checked via the conversation). */
const messageSchema = new Schema(
  {
    conversationId: { type: ObjectId, ref: "Conversation", required: true },
    organizationId: { type: ObjectId, ref: "Organization", required: true },
    senderId: { type: ObjectId, ref: "User" },
    senderRole: { type: String, enum: [...ROLES, "SYSTEM"], required: true },
    body: { type: String, maxlength: 10_000, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    readBy: { type: [{ type: ObjectId, ref: "User" }], default: [] },
    system: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ organizationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ body: "text" });

export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: Id; createdAt: Date };
export const Message = defineModel("Message", messageSchema);
