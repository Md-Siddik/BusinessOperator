/**
 * Central permission catalog (client-safe). Every post-login feature is listed here with a
 * plain-language label, the roles it may be granted to and who may grant it. The Permission
 * Management page, the server-side policy (`effectivePermissions`, `can`) and the grant service
 * all read from this one list.
 *
 * Rules encoded here:
 *  - Default deny: a non-Owner holds only what was explicitly granted (see features/access).
 *  - `ownerOnly` entries can never be granted to anyone; Company Intelligence is one of them.
 *  - `delegatedBy` names the one scoped permission that lets a Super Admin grant this entry.
 *    Holding it never implies any other grant right.
 */

export const ROLES = ["OWNER", "ADMIN", "STAFF", "DIGITAL_MARKETER", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Super Admin",
  STAFF: "Staff",
  DIGITAL_MARKETER: "Digital Marketer",
  CLIENT: "Client",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Full access, including Owner-only areas such as Company Intelligence.",
  ADMIN: "Senior team member. Sees only what the Owner grants; may manage staff when allowed.",
  STAFF: "Client-service team member. Sees only what has been granted.",
  DIGITAL_MARKETER: "Works on leads the Owner sends. Sees nothing until access is granted.",
  CLIENT: "Customer account in the client portal.",
};

export const PERMISSIONS = [
  // Company Intelligence — Owner only
  "companies.read",
  "companies.edit",
  "companies.export",
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

export type PermissionAction = "VIEW" | "EDIT" | "EXPORT" | "ASSIGN" | "MANAGE" | "GRANT" | "RUN";

export const ACTION_LABELS: Record<PermissionAction, string> = {
  VIEW: "View",
  EDIT: "Edit",
  EXPORT: "Export",
  ASSIGN: "Assign",
  MANAGE: "Manage",
  GRANT: "Grant access",
  RUN: "Run",
};

export type PermissionGroupId = "company-intelligence" | "opportunity-intelligence" | "marketing" | "clients" | "delivery" | "website" | "team" | "owner-tools";

export const PERMISSION_GROUPS: { id: PermissionGroupId; title: string; description: string }[] = [
  { id: "marketing", title: "Marketing", description: "Leads the Owner sends to Digital Marketers." },
  { id: "opportunity-intelligence", title: "Opportunity Intelligence", description: "Verified hiring and procurement opportunities from official sources." },
  { id: "clients", title: "Clients & conversations", description: "Client accounts, inquiries and live chat." },
  { id: "delivery", title: "Requests & projects", description: "Client requests, support tickets and project work." },
  { id: "website", title: "Website", description: "Public website content, translations, services and prices." },
  { id: "team", title: "Team", description: "Staff accounts and team reports." },
  { id: "company-intelligence", title: "Company Intelligence", description: "New company registrations, research, CRM and outreach built on registry data." },
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
  /** Part of Company Intelligence: Owner only, overrides every other rule. */
  companyIntelligence?: boolean;
  /** Scoped permission that lets a Super Admin grant this entry (besides the Owner). */
  delegatedBy?: Permission;
  /** The delegate must also hold this entry themselves to grant it. */
  grantorMustHold?: boolean;
  /** Only grantable to these roles when granted by a delegate (default: eligibleRoles). */
  delegateTargets?: Role[];
  /** Where it shows up — for the effective-access summary and the coverage test. */
  unlocks: string[];
};

const OWNER_ONLY = { eligibleRoles: [] as Role[], ownerOnly: true };
const CI = { ...OWNER_ONLY, group: "company-intelligence" as const, companyIntelligence: true };
/** Client-service permissions a Super Admin with "Manage staff accounts" may pass on to Staff (only those they hold). */
const STAFF_DELEGATION = { delegatedBy: "users.manage" as const, grantorMustHold: true, delegateTargets: ["STAFF"] as Role[] };

export const PERMISSION_CATALOG: PermissionDef[] = [
  /* ── Marketing ── */
  {
    key: "marketerLeads.view",
    label: "View Assigned Client Leads",
    description: "Open the client leads table and see the company name, contact person, phone and website of leads the Owner sent to this person.",
    group: "marketing",
    action: "VIEW",
    eligibleRoles: ["DIGITAL_MARKETER"],
    delegatedBy: "marketerLeads.grant",
    unlocks: ["/staff/client-leads", "GET /api/marketer/leads"],
  },
  {
    key: "marketerLeads.grant",
    label: "Manage Marketer Lead Access",
    description: "Turn “View Assigned Client Leads” on or off for Digital Marketers. Gives no other permission-management rights.",
    group: "marketing",
    action: "GRANT",
    eligibleRoles: ["ADMIN"],
    unlocks: ["/staff/users"],
  },
  { key: "leads.sendToMarketer", label: "Send Leads to Marketers", description: "Send a company from Today's New Companies to a Digital Marketer.", action: "ASSIGN", unlocks: ["/dashboard/today", "POST /api/lead-assignments"], ...CI },

  /* ── Opportunity Intelligence ── */
  {
    key: "opportunities.view",
    label: "View Opportunity Intelligence",
    description: "Read verified hiring and procurement opportunities (read only — no exports, notes or source settings).",
    group: "opportunity-intelligence",
    action: "VIEW",
    eligibleRoles: ["ADMIN", "STAFF", "DIGITAL_MARKETER"],
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
  { key: "clients.manage", label: "Manage Clients & Inquiries", description: "See client accounts and inquiries, approve sign-ups and edit client details.", group: "clients", action: "MANAGE", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/clients", "/staff/inquiries"] },
  { key: "chat.manage", label: "View All Client Conversations", description: "Read and answer every client conversation, not only assigned ones.", group: "clients", action: "VIEW", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/messages"] },
  { key: "conversations.assigned", label: "Answer Assigned Conversations", description: "Read and answer client conversations assigned to this person.", group: "clients", action: "VIEW", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/messages"] },

  /* ── Requests & projects ── */
  { key: "tickets.manage", label: "Manage All Requests & Tickets", description: "See, assign and update every client request and support ticket.", group: "delivery", action: "MANAGE", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/tickets"] },
  { key: "tickets.assigned", label: "Work on Assigned Tickets", description: "See and update requests and tickets assigned to this person.", group: "delivery", action: "EDIT", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/tickets"] },
  { key: "projects.manage", label: "Manage All Projects", description: "See and edit every client project and its tasks.", group: "delivery", action: "MANAGE", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/projects"] },
  { key: "projects.assigned", label: "Work on Assigned Projects", description: "See and update projects this person is assigned to.", group: "delivery", action: "EDIT", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/projects"] },

  /* ── Website ── */
  { key: "content.manage", label: "Edit Website Content", description: "Edit website settings, case studies, languages and translations.", group: "website", action: "EDIT", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/services", "/staff/settings/general", "/staff/settings/languages"] },
  { key: "services.manage", label: "Manage Services & Prices", description: "Publish services, prices, discounts and service landing pages.", group: "website", action: "MANAGE", eligibleRoles: ["ADMIN", "STAFF"], ...STAFF_DELEGATION, unlocks: ["/staff/services", "/staff/service-management"] },

  /* ── Team ── */
  { key: "users.manage", label: "Manage Staff Accounts", description: "Create staff accounts and pass on client-service permissions this person holds. Cannot change Super Admins or the Owner.", group: "team", action: "MANAGE", eligibleRoles: ["ADMIN"], unlocks: ["/staff/users"] },
  { key: "analytics.view", label: "View Team Reports", description: "See workload reports for clients, requests and projects.", group: "team", action: "VIEW", eligibleRoles: ["ADMIN", "STAFF"], unlocks: ["/staff/reports"] },

  /* ── Company Intelligence (Owner only) ── */
  { key: "companies.read", label: "View Company Intelligence", description: "Today's new companies, country registries, data sources, research and CRM.", action: "VIEW", unlocks: ["/dashboard/today", "/dashboard/companies", "/dashboard/sources", "/dashboard/coverage", "/dashboard/research", "/dashboard/inbox", "/dashboard/review", "/dashboard/contacts", "/dashboard/leads", "/dashboard/crm", "/dashboard/quotations", "/dashboard/analytics"], ...CI },
  { key: "companies.edit", label: "Edit Company Records", description: "Correct company and contact data, run research.", action: "EDIT", unlocks: ["/dashboard/companies"], ...CI },
  { key: "companies.export", label: "Export Company Data", description: "Download company lists as CSV.", action: "EXPORT", unlocks: ["GET /api/companies/export"], ...CI },
  { key: "registry.sync", label: "Run Registry Syncs", description: "Start registry synchronisations and manage country sources.", action: "RUN", unlocks: ["/dashboard/sources"], ...CI },
  { key: "leads.manage", label: "Manage CRM Leads", description: "Manage every lead in the CRM pipeline and follow-ups.", action: "MANAGE", unlocks: ["/dashboard/crm"], ...CI },
  { key: "outreach.manage", label: "Create Outreach", description: "Campaigns, templates and email drafts to registered companies.", action: "MANAGE", unlocks: ["/dashboard/outreach"], ...CI },
  { key: "outreach.approve", label: "Approve & Send Outreach", description: "Approve and send outreach emails.", action: "MANAGE", unlocks: ["/dashboard/outreach/queue"], ...CI },

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

/** Grantable at all (to someone other than the Owner). Company Intelligence never is. */
export function isGrantable(p: Permission) {
  const d = PERMISSION_DEFS[p];
  return !!d && !d.ownerOnly && !d.companyIntelligence && d.eligibleRoles.length > 0;
}

export const COMPANY_INTELLIGENCE_PERMISSIONS = PERMISSION_CATALOG.filter((d) => d.companyIntelligence).map((d) => d.key);
/** Scoped "grant" authorities whose downstream grants are revoked with them (see features/access). */
export const SCOPED_GRANT_AUTHORITIES: Permission[] = ["opportunities.grant", "marketerLeads.grant"];

/** Suggested starting access shown (and editable) when the Owner creates an account. Never applied silently. */
export const ROLE_TEMPLATES: Record<Role, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: ["clients.manage", "chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "content.manage", "services.manage", "users.manage", "analytics.view"],
  STAFF: ["chat.manage", "conversations.assigned", "tickets.manage", "tickets.assigned", "projects.manage", "projects.assigned", "content.manage"],
  DIGITAL_MARKETER: [],
  CLIENT: [],
};
