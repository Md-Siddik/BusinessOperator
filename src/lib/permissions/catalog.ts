/**
 * Central permission catalog (client-safe). Every post-login feature is listed here with a
 * plain-language label, the service it belongs to, the action it allows, the roles it may be
 * granted to and who may grant it. The Permission Management page, the server-side policy
 * (`effectivePermissions`, `can`) and the grant service all read from this one list.
 *
 * Rules encoded here:
 *  - Default deny: a non-Owner holds only what was explicitly granted (see features/access).
 *    Roles decide eligibility and workspace, never access by themselves.
 *  - `ownerOnly` entries can never be granted to anyone (Owner tools, and the CRM / outreach /
 *    registry-sync tools of Company Intelligence). Viewing, editing, exporting and deleting
 *    Company Intelligence records are grantable per person by the Owner.
 *  - `delegatedBy` names the one scoped permission that lets an Admin grant this entry.
 *    Holding it never implies any other grant right.
 */

export const ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
  DIGITAL_MARKETER: "Digital Marketer",
  CLIENT: "Client",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Full access to every service, setting, user and permission. Final administrative authority.",
  ADMIN: "Manages the services and users the Owner assigns. Never receives Owner-level privileges automatically.",
  MANAGER: "Manages assigned team workflows and services. Access is controlled by the Owner.",
  STAFF: "Client-service team member. Sees only what has been granted.",
  DIGITAL_MARKETER: "Marketing tools, company intelligence, contacts, lead workflows and exports — only as granted.",
  CLIENT: "Customer account in the client portal. Sees only what is explicitly shared with them.",
};

export const PERMISSIONS = [
  // Company Intelligence — view / edit / export / delete are grantable; the tools below them are Owner only
  "companies.read",
  "companies.edit",
  "companies.export",
  "companies.delete",
  "companies.grant",
  "registry.sync",
  "leads.manage",
  "leads.sendToMarketer",
  "outreach.manage",
  "outreach.approve",
  // Opportunity Intelligence
  "opportunities.view",
  "opportunities.grant",
  "opportunities.manage",
  // Marketing
  "marketerLeads.view",
  "marketerLeads.grant",
  "marketerTable.manage",
  // Clients & communication
  "clients.manage",
  "chat.manage",
  "conversations.assigned",
  // Delivery
  "tickets.manage",
  "tickets.assigned",
  "projects.manage",
  "projects.assigned",
  // Website
  "content.manage",
  "services.manage",
  // Team
  "users.manage",
  "analytics.view",
  // Owner tools
  "websiteAnalytics.view",
  "emailSender.use",
  "mailbox.view",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type PermissionAction = "VIEW" | "CREATE" | "EDIT" | "DELETE" | "EXPORT" | "ASSIGN" | "MANAGE" | "GRANT" | "RUN";

export const ACTION_LABELS: Record<PermissionAction, string> = {
  VIEW: "View",
  CREATE: "Create",
  EDIT: "Edit",
  DELETE: "Delete",
  EXPORT: "Export",
  ASSIGN: "Assign",
  MANAGE: "Manage",
  GRANT: "Grant access",
  RUN: "Run",
};

export type PermissionGroupId = "company-intelligence" | "opportunity-intelligence" | "marketing" | "clients" | "delivery" | "website" | "team" | "owner-tools";

/** Services, in the order the Permission Management page lists them (one card per service). */
export const PERMISSION_GROUPS: { id: PermissionGroupId; title: string; description: string }[] = [
  { id: "company-intelligence", title: "Company Intelligence", description: "Startups and established companies with business contacts, contact status, sources and exports." },
  { id: "marketing", title: "Digital Marketer", description: "The client-leads workspace for companies the Owner sends to Digital Marketers." },
  { id: "opportunity-intelligence", title: "Opportunity Intelligence", description: "Verified hiring and procurement opportunities from official sources." },
  { id: "clients", title: "Clients & conversations", description: "Client accounts, inquiries and live chat." },
  { id: "delivery", title: "Requests & projects", description: "Client requests, support tickets and project work." },
  { id: "website", title: "Website", description: "Public website content, translations, services and prices." },
  { id: "team", title: "Team Management", description: "Staff accounts and team reports." },
  { id: "owner-tools", title: "Owner tools", description: "Private Owner mailboxes, website traffic, system settings and audit logs." },
];

export type PermissionDef = {
  key: Permission;
  label: string;
  description: string;
  group: PermissionGroupId;
  action: PermissionAction;
  /** Roles this may be granted to. Empty = nobody but the Owner (implicitly). */
  eligibleRoles: Role[];
  /** Never grantable — the Owner holds it by role. */
  ownerOnly?: boolean;
  /** Part of Company Intelligence. */
  companyIntelligence?: boolean;
  /** Scoped permission that lets an Admin grant this entry (besides the Owner). */
  delegatedBy?: Permission;
  /** The delegate must also hold this entry themselves to grant it. */
  grantorMustHold?: boolean;
  /** Only grantable to these roles when granted by a delegate (default: eligibleRoles). */
  delegateTargets?: Role[];
  /** Where it shows up — for the effective-access summary and the coverage test. */
  unlocks: string[];
};

const OWNER_ONLY = { eligibleRoles: [] as Role[], ownerOnly: true };
/** Owner-only Company Intelligence tools (registry syncs, CRM pipeline, outreach, lead handoff). */
const CI = { ...OWNER_ONLY, group: "company-intelligence" as const, companyIntelligence: true };
/** Grantable Company Intelligence data access. */
const CI_DATA = { group: "company-intelligence" as const, companyIntelligence: true };
/** Client-service team roles. */
const CLIENT_SERVICE: Role[] = ["ADMIN", "MANAGER", "STAFF"];
/** Client-service permissions an Admin with "Manage staff accounts" may pass on to Staff (only those they hold). */
const STAFF_DELEGATION = { delegatedBy: "users.manage" as const, grantorMustHold: true, delegateTargets: ["STAFF"] as Role[] };

export const PERMISSION_CATALOG: PermissionDef[] = [
  /* ── Company Intelligence ── */
  {
    key: "companies.read",
    label: "View Company Intelligence",
    description: "Browse startups and established companies with their business contacts, contact status and sources (no CRM, outreach or private team data).",
    action: "VIEW",
    eligibleRoles: ["ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"],
    delegatedBy: "companies.grant",
    grantorMustHold: true,
    unlocks: ["/staff/companies", "GET /api/company-intel", "/dashboard/today", "/dashboard/companies", "/dashboard/old-companies", "/dashboard/sources", "/dashboard/coverage", "/dashboard/research", "/dashboard/inbox", "/dashboard/review", "/dashboard/contacts", "/dashboard/leads", "/dashboard/crm", "/dashboard/quotations", "/dashboard/analytics"],
    ...CI_DATA,
  },
  { key: "companies.edit", label: "Edit Company Records", description: "Correct the Company Type of a record and request a contact refresh.", action: "EDIT", eligibleRoles: ["ADMIN", "MANAGER", "DIGITAL_MARKETER"], unlocks: ["POST /api/company-intel/[id]/type", "POST /api/company-intel/[id]/refresh"], ...CI_DATA },
  { key: "companies.export", label: "Export Company Data", description: "Download company lists as CSV (restricted and suppressed contacts are withheld).", action: "EXPORT", eligibleRoles: ["ADMIN", "MANAGER", "DIGITAL_MARKETER"], unlocks: ["GET /api/company-intel/export"], ...CI_DATA },
  { key: "companies.delete", label: "Delete Company Records", description: "Remove a company record and its contact data; its email addresses are added to the suppression list.", action: "DELETE", eligibleRoles: ["ADMIN"], unlocks: ["DELETE /api/company-intel/[id]"], ...CI_DATA },
  {
    key: "companies.grant",
    label: "Grant Company Intelligence Access",
    description: "Give or remove “View Company Intelligence” for other team members. Works only together with View Company Intelligence, and never covers edit, export or delete.",
    action: "GRANT",
    eligibleRoles: ["ADMIN"],
    unlocks: ["/staff/users"],
    ...CI_DATA,
  },
  { key: "registry.sync", label: "Run Registry Syncs", description: "Start registry synchronisations and manage country sources.", action: "RUN", unlocks: ["/dashboard/sources"], ...CI },
  { key: "leads.manage", label: "Manage CRM Leads", description: "Manage every lead in the CRM pipeline and follow-ups.", action: "MANAGE", unlocks: ["/dashboard/crm"], ...CI },
  { key: "leads.sendToMarketer", label: "Send Leads to Marketers", description: "Send a company from Today's New Companies to the Digital Marketer table, and manage the whole table (edit, delete, any status).", action: "ASSIGN", unlocks: ["/dashboard/today", "POST /api/lead-assignments", "/dashboard/marketer-leads", "GET /api/marketer/assignments", "PATCH /api/marketer/assignments/[id]", "DELETE /api/marketer/assignments/[id]"], ...CI },
  { key: "outreach.manage", label: "Create Outreach", description: "Campaigns, templates and email drafts to registered companies.", action: "MANAGE", unlocks: ["/dashboard/outreach"], ...CI },
  { key: "outreach.approve", label: "Approve & Send Outreach", description: "Approve and send outreach emails.", action: "MANAGE", unlocks: ["/dashboard/outreach/queue"], ...CI },

  /* ── Digital Marketer ── */
  {
    key: "marketerLeads.view",
    label: "View Marketer Table",
    description: "Open the shared Digital Marketer table: every lead the Owner sent to it, with company name, contact person, phone, website and Company Type. Digital Marketers also set each lead's outreach status; Admins see the same table read-only.",
    group: "marketing",
    action: "VIEW",
    eligibleRoles: ["DIGITAL_MARKETER", "ADMIN"],
    delegatedBy: "marketerLeads.grant",
    unlocks: ["/staff/client-leads", "GET /api/marketer/leads"],
  },
  {
    key: "marketerLeads.grant",
    label: "Manage Marketer Lead Access",
    description: "Turn “View Marketer Table” on or off for Digital Marketers. Gives no other permission-management rights.",
    group: "marketing",
    action: "GRANT",
    eligibleRoles: ["ADMIN"],
    unlocks: ["/staff/users"],
  },
  {
    key: "marketerTable.manage",
    label: "Manage Marketer Table",
    description: "The full Digital Marketer management table: every record (active and withdrawn), edit the shown company and contact details, set any outreach status, withdraw, re-activate and delete records, and read their change history. Granted by the Owner only.",
    group: "marketing",
    action: "MANAGE",
    eligibleRoles: ["ADMIN"],
    unlocks: ["/staff/marketer-table", "GET /api/marketer/assignments", "PATCH /api/marketer/assignments/[id]", "DELETE /api/marketer/assignments/[id]"],
  },

  /* ── Opportunity Intelligence ── */
  {
    key: "opportunities.view",
    label: "View Opportunity Intelligence",
    description: "Read verified hiring and procurement opportunities (read only — no exports, notes or source settings).",
    group: "opportunity-intelligence",
    action: "VIEW",
    eligibleRoles: ["ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"],
    delegatedBy: "opportunities.grant",
    grantorMustHold: true,
    unlocks: ["/staff/opportunities"],
  },
  {
    key: "opportunities.grant",
    label: "Grant Opportunity Intelligence Access",
    description: "Give or remove “View Opportunity Intelligence” for other team members. Works only together with View Opportunity Intelligence, and never covers any other permission.",
    group: "opportunity-intelligence",
    action: "GRANT",
    eligibleRoles: ["ADMIN"],
    unlocks: ["/staff/users"],
  },
  {
    key: "opportunities.manage",
    label: "Manage Opportunity Intelligence",
    description: "Verify, save, annotate and export opportunities, and configure sources.",
    group: "opportunity-intelligence",
    action: "MANAGE",
    unlocks: ["/dashboard/opportunities"],
    ...OWNER_ONLY,
  },

  /* ── Clients & conversations ── */
  { key: "clients.manage", label: "Manage Clients & Inquiries", description: "See client accounts and inquiries, approve sign-ups and edit client details.", group: "clients", action: "MANAGE", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/clients", "/staff/inquiries"] },
  { key: "chat.manage", label: "View All Client Conversations", description: "Read and answer every client conversation, not only assigned ones.", group: "clients", action: "VIEW", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/messages"] },
  { key: "conversations.assigned", label: "Answer Assigned Conversations", description: "Read and answer client conversations assigned to this person.", group: "clients", action: "VIEW", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/messages"] },

  /* ── Requests & projects ── */
  { key: "tickets.manage", label: "Manage All Requests & Tickets", description: "See, assign and update every client request and support ticket.", group: "delivery", action: "MANAGE", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/tickets"] },
  { key: "tickets.assigned", label: "Work on Assigned Tickets", description: "See and update requests and tickets assigned to this person.", group: "delivery", action: "EDIT", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/tickets"] },
  { key: "projects.manage", label: "Manage All Projects", description: "See and edit every client project and its tasks.", group: "delivery", action: "MANAGE", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/projects"] },
  { key: "projects.assigned", label: "Work on Assigned Projects", description: "See and update projects this person is assigned to.", group: "delivery", action: "EDIT", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/projects"] },

  /* ── Website ── */
  { key: "content.manage", label: "Edit Website Content", description: "Edit website settings, case studies, languages and translations.", group: "website", action: "EDIT", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/services", "/staff/settings/general", "/staff/settings/languages"] },
  { key: "services.manage", label: "Manage Services & Prices", description: "Publish services, prices, discounts and service landing pages.", group: "website", action: "MANAGE", eligibleRoles: CLIENT_SERVICE, ...STAFF_DELEGATION, unlocks: ["/staff/services", "/staff/service-management"] },

  /* ── Team Management ── */
  { key: "users.manage", label: "Manage Staff Accounts", description: "Create staff accounts and pass on client-service permissions this person holds. Cannot change Admins, Managers or the Owner.", group: "team", action: "MANAGE", eligibleRoles: ["ADMIN"], unlocks: ["/staff/users"] },
  { key: "analytics.view", label: "View Team Reports", description: "See workload reports for clients, requests and projects.", group: "team", action: "VIEW", eligibleRoles: CLIENT_SERVICE, unlocks: ["/staff/reports"] },

  /* ── Owner tools ── */
  { key: "websiteAnalytics.view", label: "View Website Analytics", description: "Visitor-level website traffic and exports.", group: "owner-tools", action: "VIEW", unlocks: ["/dashboard/website-analytics"], ...OWNER_ONLY },
  { key: "emailSender.use", label: "Use the Email Sender", description: "Send one-to-one emails from the Owner mailbox.", group: "owner-tools", action: "MANAGE", unlocks: ["/dashboard/email-sender"], ...OWNER_ONLY },
  { key: "mailbox.view", label: "Read Client Mail", description: "Read the Owner's client mailbox.", group: "owner-tools", action: "VIEW", unlocks: ["/dashboard/mailbox"], ...OWNER_ONLY },
  { key: "settings.manage", label: "Manage System Settings", description: "Countries, research, scoring, outreach and chat settings.", group: "owner-tools", action: "MANAGE", unlocks: ["/dashboard/settings"], ...OWNER_ONLY },
  { key: "audit.view", label: "View Audit Logs", description: "Every recorded change, including permission changes.", group: "owner-tools", action: "VIEW", unlocks: ["/dashboard/audit"], ...OWNER_ONLY },
];

export const PERMISSION_DEFS = Object.fromEntries(PERMISSION_CATALOG.map((d) => [d.key, d])) as Record<Permission, PermissionDef>;

/** Short labels (kept for older imports). */
export const PERMISSION_LABELS = Object.fromEntries(PERMISSION_CATALOG.map((d) => [d.key, d.label])) as Record<Permission, string>;

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/** Permissions a role may ever hold through a grant (Owner holds everything by role). */
export function eligiblePermissions(role: Role): Permission[] {
  if (role === "OWNER") return [...PERMISSIONS];
  return PERMISSION_CATALOG.filter((d) => !d.ownerOnly && d.eligibleRoles.includes(role)).map((d) => d.key);
}

/** Grantable at all (to someone other than the Owner). Owner-only entries never are. */
export function isGrantable(p: Permission) {
  const d = PERMISSION_DEFS[p];
  return !!d && !d.ownerOnly && d.eligibleRoles.length > 0;
}

export const COMPANY_INTELLIGENCE_PERMISSIONS = PERMISSION_CATALOG.filter((d) => d.companyIntelligence).map((d) => d.key);
/** Scoped "grant" authorities whose downstream grants are revoked with them (see features/access). */
export const SCOPED_GRANT_AUTHORITIES: Permission[] = ["opportunities.grant", "marketerLeads.grant", "companies.grant"];

/**
 * What every Digital Marketer starts with: the shared marketer table (see every lead the Owner sent
 * and set its outreach status). In the role template; existing marketers received it through
 * migration "2026-10-marketer-table-v1". Never a system-wide or administrative permission.
 */
export const DIGITAL_MARKETER_HANDOFF_PERMISSIONS: Permission[] = ["marketerLeads.view"];

/**
 * Built-in starting access per role, shown (and editable) when an account is created. The Owner
 * can replace them in Permission Management → Role templates (stored as a setting, see
 * features/access). Never applied silently to existing accounts.
 */
export const ROLE_TEMPLATES: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  // Admins see the shared marketer table read-only; managing it is a separate Owner grant.
  ADMIN: ["clients.manage", "chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "content.manage", "services.manage", "users.manage", "analytics.view", "marketerLeads.view"],
  MANAGER: ["clients.manage", "chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "analytics.view"],
  STAFF: ["chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "content.manage"],
  // The shared marketer table. Broader research access — Company / Opportunity Intelligence —
  // stays an explicit Owner grant.
  DIGITAL_MARKETER: [...DIGITAL_MARKETER_HANDOFF_PERMISSIONS],
  CLIENT: [],
};

/**
 * Named access presets for faster setup ("Apply a template" on a person). Applying one sets the
 * person's access to exactly the preset — limited to what their role may hold and what the
 * person applying it may change. Every change is an individual, audited grant or revocation.
 */
export type AccessPreset = { id: string; label: string; description: string; roles: Role[]; permissions: Permission[] };
export const ACCESS_PRESETS: AccessPreset[] = [
  { id: "marketer-full", label: "Marketer — research & outreach lists", description: "Client leads, Company Intelligence (view, edit, export) and Opportunity Intelligence.", roles: ["DIGITAL_MARKETER"], permissions: ["marketerLeads.view", "companies.read", "companies.edit", "companies.export", "opportunities.view"] },
  { id: "marketer-view", label: "Marketer — view only", description: "Client leads and Company Intelligence, read only.", roles: ["DIGITAL_MARKETER"], permissions: ["marketerLeads.view", "companies.read"] },
  { id: "manager-team", label: "Manager — team workflows", description: "Clients, conversations, requests, projects, team reports, Company and Opportunity Intelligence (view).", roles: ["MANAGER"], permissions: ["clients.manage", "chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "analytics.view", "companies.read", "opportunities.view"] },
  { id: "admin-operations", label: "Admin — operations", description: "Every client-service area, website, staff accounts, reports and Company Intelligence (view, export).", roles: ["ADMIN"], permissions: [...ROLE_TEMPLATES.ADMIN, "opportunities.view", "companies.read", "companies.export"] },
  { id: "client-service", label: "Client service", description: "All conversations, requests and projects.", roles: ["ADMIN", "MANAGER", "STAFF"], permissions: ["chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned"] },
  { id: "assigned-only", label: "Assigned work only", description: "Only conversations, tickets and projects assigned to this person.", roles: ["ADMIN", "MANAGER", "STAFF"], permissions: ["conversations.assigned", "tickets.assigned", "projects.assigned"] },
  { id: "no-access", label: "No access", description: "Remove everything — the person keeps only their profile and notifications.", roles: ["ADMIN", "MANAGER", "STAFF", "DIGITAL_MARKETER"], permissions: [] },
];
