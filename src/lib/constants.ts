/**
 * Domain enums shared by models, services and UI. Client-safe (no server imports).
 */
export const ACCOUNT_STATUSES = ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const LEAD_STAGES = [
  "NEW",
  "RESEARCHING",
  "CONTACT_AVAILABLE",
  "QUALIFIED",
  "QUOTATION_DRAFTED",
  "READY_FOR_OUTREACH",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "CLIENT",
  "LOST",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const PIPELINE_STAGES: LeadStage[] = LEAD_STAGES.filter((s) => s !== "NOT_INTERESTED" && s !== "DO_NOT_CONTACT" && s !== "LOST");
export const CLOSED_STAGES: LeadStage[] = ["LOST", "NOT_INTERESTED", "DO_NOT_CONTACT"];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  RESEARCHING: "Researching",
  CONTACT_AVAILABLE: "Contact available",
  QUALIFIED: "Qualified",
  QUOTATION_DRAFTED: "Quotation drafted",
  READY_FOR_OUTREACH: "Ready for Outreach",
  CONTACTED: "Contacted",
  REPLIED: "Replied",
  MEETING: "Meeting",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  CLIENT: "Client",
  LOST: "Lost",
  NOT_INTERESTED: "Not Interested",
  DO_NOT_CONTACT: "Do Not Contact",
};
/** Stages at or beyond a milestone — used for funnel counts ("contacted" includes replied, meeting…). */
export function stagesFrom(stage: LeadStage): LeadStage[] {
  const idx = PIPELINE_STAGES.indexOf(stage);
  return idx < 0 ? [stage] : PIPELINE_STAGES.slice(idx);
}

export const CRM_ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "STAGE_CHANGE", "ASSIGNMENT", "TASK", "SYSTEM", "CONTACT_ATTEMPT"] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export const FOLLOW_UP_TYPES = ["EMAIL", "CALL", "MEETING", "LINKEDIN", "OTHER"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"];

export const TICKET_KINDS = ["REQUEST", "TICKET"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const REQUEST_TYPES = [
  "WEBSITE_UPDATE",
  "NEW_PAGE",
  "SEO",
  "RECRUITMENT",
  "TECHNICAL_ISSUE",
  "SOFTWARE",
  "AUTOMATION",
  "SOCIAL_MEDIA",
  "OTHER",
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const CONVERSATION_TOPICS = [
  "GENERAL",
  "WEBSITE",
  "SEO",
  "RECRUITMENT",
  "TECHNICAL_SUPPORT",
  "PROJECT",
  "BILLING",
  "NEW_SERVICE",
  "OTHER",
] as const;
export type ConversationTopic = (typeof CONVERSATION_TOPICS)[number];

export const CONVERSATION_STATUSES = TICKET_STATUSES;
export type ConversationStatus = TicketStatus;

export const PROJECT_STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CLIENT_SERVICE_STATUSES = ["REQUESTED", "PENDING", "ACTIVE", "COMPLETED"] as const;
export type ClientServiceStatus = (typeof CLIENT_SERVICE_STATUSES)[number];

export const DOCUMENT_CATEGORIES = ["PROPOSAL", "CONTRACT", "BRAND_ASSET", "REQUIREMENTS", "REPORT", "OTHER"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** DIRECT = single-recipient emails the Owner sends from the Email Sender. */
export const EMAIL_KINDS = ["OUTREACH", "TRANSACTIONAL", "DIRECT"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  /** Handed to the provider, outcome not recorded yet (also the duplicate-send lock). */
  "SENDING",
  /** SENT = accepted by the provider (not proof of delivery). */
  "SENT",
  "DELIVERED",
  "FAILED",
  "BOUNCED",
  "SUPPRESSED",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const SUPPRESSION_REASONS = ["OPT_OUT", "BOUNCE", "COMPLAINT", "DO_NOT_CONTACT", "MANUAL"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const NOTIFICATION_TYPES = [
  "QUALIFIED_LEAD",
  "FOLLOW_UP_DUE",
  "REPLY",
  "MEETING",
  "CLIENT_SIGNUP",
  "CLIENT_REQUEST",
  "CHAT_MESSAGE",
  "CLIENT_EMAIL",
  "SYNC_COMPLETED",
  "SYNC_FAILED",
  "SYSTEM",
  "ACCOUNT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
/** Routine background events — never raised as notifications and hidden from older stored ones. */
export const QUIET_NOTIFICATION_TYPES: NotificationType[] = ["SYNC_COMPLETED", "SYNC_FAILED"];

export const SYNC_STATUSES = ["RUNNING", "SUCCESS", "PARTIAL", "FAILED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const CONTACT_REQUEST_STATUSES = ["NEW", "IN_REVIEW", "CONVERTED", "ARCHIVED"] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

/** Chat attachment & document upload limits. */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxFilesPerMessage: 5,
  allowedMimeTypes: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  allowedExtensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".txt", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".pptx"],
} as const;
