import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  AuditLog,
  CaseStudy,
  ClientDocument,
  ClientService,
  Company,
  ContactRequest,
  Conversation,
  CrmActivity,
  EmailCampaign,
  EmailMessage,
  EmailTemplate,
  FollowUp,
  Message,
  Notification,
  Organization,
  Project,
  ProjectTask,
  SuppressionEntry,
  SupportTicket,
  SystemSetting,
  User,
  nextSequence,
  type CompanyDoc,
  type UserDoc,
} from "@/models";
import { hashPassword } from "@/lib/auth/password";
import { toActor } from "@/lib/auth/actor";
import { LEAD_STAGES, type LeadStage } from "@/lib/constants";
import { COUNTRIES } from "@/config/countries";
import { getStorage } from "@/lib/storage";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { ensureCountries } from "@/features/countries/service";
import { runSync } from "@/features/registry/sync";
import { isDemoModeEnabled } from "@/lib/data-mode";
import { addDays, todayIn } from "@/lib/dates/country-time";
import { Country } from "@/models";
import { approveMessage, generateCampaignDrafts, markReplied, sendApprovedMessage, submitForReview } from "@/features/outreach/service";
import { DEMO_TEMPLATES } from "./templates";

type Log = (msg: string) => void;
const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);
const ahead = (days: number, hours = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hours, 0, 0, 0);
  return d;
};

export function demoCredentials() {
  const password = process.env.DEMO_PASSWORD || "";
  return {
    password,
    owner: process.env.DEMO_OWNER_EMAIL || "owner@demo.exploretechify.local",
    admin: process.env.DEMO_ADMIN_EMAIL || "admin@demo.exploretechify.local",
    staff: process.env.DEMO_STAFF_EMAIL || "staff@demo.exploretechify.local",
    client: process.env.DEMO_CLIENT_EMAIL || "client@demo.exploretechify.local",
  };
}

/**
 * Seeds only an empty database (used automatically when DEMO_MODE=true).
 * A unique lock document makes this safe when several Next.js worker
 * processes start at once — only the first one seeds.
 */
export async function autoSeedIfEmpty(log: Log = (m) => console.info(`[seed] ${m}`)) {
  if (await User.exists({})) return false;
  try {
    await SystemSetting.create({ key: "__demo_seed_lock", value: { at: new Date(), pid: process.pid } });
  } catch {
    return false; // another process holds the lock and is seeding
  }
  try {
    await seedDatabase({ log });
    return true;
  } finally {
    await SystemSetting.deleteOne({ key: "__demo_seed_lock" });
  }
}

export async function resetDatabase() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected");
  const collections = await db.listCollections().toArray();
  for (const c of collections) await db.collection(c.name).deleteMany({});
}

export async function seedDatabase({ reset = false, log = console.info as Log } = {}) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data in production (set ALLOW_DEMO_SEED=true to override).");
  }
  if (reset) await resetDatabase();

  const creds = demoCredentials();
  let password = creds.password;
  if (!password || password.length < 10) {
    password = crypto.randomBytes(9).toString("base64url");
    log(`DEMO_PASSWORD not set (or < 10 chars). Generated a one-off demo password: ${password}`);
  }
  const passwordHash = await hashPassword(password);
  log("Creating countries and demo users…");
  await ensureCountries();

  const mkUser = (data: Partial<UserDoc> & { email: string; name: string; role: UserDoc["role"] }) =>
    User.create({ status: "ACTIVE", passwordHash, isDemo: true, permissions: ROLE_DEFAULT_PERMISSIONS[data.role as keyof typeof ROLE_DEFAULT_PERMISSIONS], ...data });

  const owner = await mkUser({ email: creds.owner, name: "Olivia Owner", role: "OWNER" });
  const admin = await mkUser({ email: creds.admin, name: "Anders Admin", role: "ADMIN" });
  const staff = await mkUser({ email: creds.staff, name: "Sara Staff", role: "STAFF" });
  const staff2 = await mkUser({ email: "staff2@demo.exploretechify.local", name: "Mikkel Staff", role: "STAFF" });
  const ownerActor = toActor(owner);
  const adminActor = toActor(admin);
  const internal = [owner, admin, staff, staff2];

  // ── Company intelligence ──
  // Real data mode (default): no companies are generated. The registry scheduler fills
  // each connected country from its official source shortly after start-up.
  // Demo mode (DEMO_MODE=true, development only): fictional companies from demo providers.
  const demoCompanies = isDemoModeEnabled();
  if (demoCompanies) {
    for (const c of COUNTRIES) {
      log(`Importing DEMO registrations for ${c.name}…`);
      await Country.updateOne({ code: c.code }, { $set: { providerId: `mock-${c.slug}` } });
      const today = todayIn(c.timezone);
      await runSync({ countryCode: c.code, kind: "RANGE", from: addDays(today, -60), to: today, trigger: "SEED", notify: false, actor: ownerActor });
    }
  } else {
    log("Real data mode: no demo companies. Connected registries sync automatically after start-up.");
  }

  // ── CRM: progress a realistic share of qualified leads through the pipeline ──
  log("Building CRM pipeline…");
  const progression: LeadStage[] = ["RESEARCHING", "READY_FOR_OUTREACH", "READY_FOR_OUTREACH", "CONTACTED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION", "WON", "NOT_INTERESTED"];
  for (const c of demoCompanies ? COUNTRIES : []) {
    const qualified = await Company.find({ countryCode: c.code, email: { $exists: true } }).sort({ "lead.score": -1 }).limit(16).lean<CompanyDoc[]>();
    for (let i = 0; i < qualified.length; i++) {
      const company = qualified[i]!;
      const stage = i < progression.length ? progression[i]! : "QUALIFIED";
      const assignee = [staff, staff, admin, staff2][i % 4]!;
      const stageIdx = LEAD_STAGES.indexOf(stage);
      await Company.updateOne(
        { _id: company._id },
        {
          $set: {
            "lead.stage": stage,
            "lead.assignedTo": assignee._id,
            "lead.stageChangedAt": ago(i % 9),
            ...(stageIdx >= LEAD_STAGES.indexOf("CONTACTED") && stage !== "NOT_INTERESTED" && { "lead.lastContactedAt": ago(2 + (i % 6)) }),
          },
        },
      );
      await CrmActivity.create([
        { companyId: company._id, countryCode: c.code, type: "ASSIGNMENT", body: `Assigned to ${assignee.name}`, actorId: admin._id, isDemo: true, createdAt: ago(10 - (i % 5)) },
        { companyId: company._id, countryCode: c.code, type: "NOTE", body: company.website ? "Website exists but looks outdated — good audit candidate." : "No website found. Newly registered — strong fit for the digital foundation package.", actorId: assignee._id, isDemo: true, createdAt: ago(8 - (i % 5)) },
        { companyId: company._id, countryCode: c.code, type: "STAGE_CHANGE", body: undefined, meta: { from: "QUALIFIED", to: stage }, actorId: assignee._id, isDemo: true, createdAt: ago(i % 9) },
      ]);
      if (["CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION"].includes(stage)) {
        const offset = [-2, 0, 0, 1, 3, 6][i % 6]!;
        const dueAt = offset === 0 ? ahead(0, 14) : offset < 0 ? ago(-offset) : ahead(offset);
        await FollowUp.create({ companyId: company._id, countryCode: c.code, dueAt, type: i % 2 ? "CALL" : "EMAIL", assignedTo: assignee._id, notes: stage === "MEETING" ? "Send meeting summary and next steps." : "Check in after first email.", createdBy: assignee._id, isDemo: true });
        await Company.updateOne({ _id: company._id }, { $set: { "lead.nextFollowUpAt": dueAt } });
      }
    }
  }

  // ── Clients (organizations) ──
  log("Creating demo clients, services, projects and tickets…");
  const noClientCompany = demoCompanies ? await Company.findOne({ countryCode: "NO", industry: "hospitality", isDemo: true }).lean<CompanyDoc>() : null;
  const orgA = await Organization.create({ name: "Nordlys Bakeri AS (Demo)", slug: "nordlys-bakeri-demo", countryCode: "NO", website: "https://www.nordlys-bakeri.example", industry: "hospitality", status: "ACTIVE", preferredLanguage: "no", accountManagerId: staff._id, companyId: noClientCompany?._id, isDemo: true });
  const orgB = await Organization.create({ name: "Brandt Logistik GmbH (Demo)", slug: "brandt-logistik-demo", countryCode: "DE", website: "https://www.brandt-logistik.example", industry: "logistics", status: "ACTIVE", preferredLanguage: "de", accountManagerId: admin._id, isDemo: true });
  const orgC = await Organization.create({ name: "Lumière Studio SAS (Demo)", slug: "lumiere-studio-demo", countryCode: "FR", industry: "design", status: "PENDING_APPROVAL", preferredLanguage: "fr", isDemo: true });
  if (noClientCompany) await Company.updateOne({ _id: noClientCompany._id }, { $set: { "lead.stage": "CLIENT", "lead.organizationId": orgA._id } });

  const clientA = await mkUser({ email: creds.client, name: "Ingrid Nordlys", role: "CLIENT", organizationId: orgA._id, preferredLanguage: "no", permissions: [] });
  const clientB = await mkUser({ email: "client-b@demo.exploretechify.local", name: "Jonas Brandt", role: "CLIENT", organizationId: orgB._id, preferredLanguage: "de", permissions: [] });
  await mkUser({ email: "client-c@demo.exploretechify.local", name: "Camille Lefèvre", role: "CLIENT", organizationId: orgC._id, status: "PENDING_APPROVAL", preferredLanguage: "fr", permissions: [] });

  await ClientService.create([
    { organizationId: orgA._id, category: "digital-foundation", itemKey: "businessWebsite", name: "Business Website", status: "COMPLETED", startedAt: ago(80), completedAt: ago(45), isDemo: true },
    { organizationId: orgA._id, category: "digital-operations", itemKey: "websiteMaintenance", name: "Website Maintenance", status: "ACTIVE", startedAt: ago(45), isDemo: true },
    { organizationId: orgA._id, category: "growth-visibility", itemKey: "localSeo", name: "Local SEO", status: "ACTIVE", startedAt: ago(30), isDemo: true },
    { organizationId: orgA._id, category: "people-recruitment", itemKey: "recruitmentSupport", name: "Recruitment Support", status: "REQUESTED", requestedBy: clientA._id, notes: "Need two bakers for the new shop.", isDemo: true },
    { organizationId: orgB._id, category: "business-systems", itemKey: "orderManagement", name: "Order Management", status: "ACTIVE", startedAt: ago(60), isDemo: true },
    { organizationId: orgB._id, category: "automation-ai", itemKey: "reportingAutomation", name: "Reporting Automation", status: "PENDING", isDemo: true },
  ]);

  const projA = await Project.create({ organizationId: orgA._id, name: "New shop launch — online presence", description: "Google Business Profile for the second location, website location page and opening campaign.", status: "ACTIVE", startDate: ago(14), dueDate: ahead(21), assignedStaff: [staff._id], createdBy: admin._id, isDemo: true, activity: [{ at: ago(14), actorId: admin._id, text: "Project created" }, { at: ago(3), actorId: staff._id, text: "Location page drafted" }] });
  const projB = await Project.create({ organizationId: orgB._id, name: "Order dashboard", description: "A simple dashboard of daily orders and delivery status.", status: "PLANNED", startDate: ahead(5), dueDate: ahead(40), assignedStaff: [admin._id, staff2._id], createdBy: admin._id, isDemo: true, activity: [{ at: ago(2), actorId: admin._id, text: "Project created" }] });
  await ProjectTask.create([
    { projectId: projA._id, organizationId: orgA._id, title: "Create Google Business Profile for new location", status: "DONE", assigneeId: staff._id, isDemo: true },
    { projectId: projA._id, organizationId: orgA._id, title: "Location page on website", status: "IN_PROGRESS", dueDate: ahead(4), assigneeId: staff._id, isDemo: true },
    { projectId: projA._id, organizationId: orgA._id, title: "Opening-week social posts", status: "TODO", dueDate: ahead(15), assigneeId: staff._id, isDemo: true },
    { projectId: projA._id, organizationId: orgA._id, title: "Internal: check NAP consistency across directories", status: "TODO", visibleToClient: false, isDemo: true },
    { projectId: projB._id, organizationId: orgB._id, title: "Requirements workshop", status: "TODO", dueDate: ahead(6), assigneeId: admin._id, isDemo: true },
  ]);

  const mkTicket = async (data: Record<string, unknown>) => SupportTicket.create({ number: await nextSequence("ticket"), isDemo: true, ...data });
  await mkTicket({ organizationId: orgA._id, kind: "REQUEST", requestType: "WEBSITE_UPDATE", title: "Update opening hours for autumn", description: "From 1 November we open at 07:00 on weekdays. Please update the website and Google profile.", status: "IN_PROGRESS", priority: "NORMAL", assignedTo: staff._id, createdBy: clientA._id, comments: [{ authorId: staff._id, body: "On it — website updated, Google profile pending verification.", createdAt: ago(1) }, { authorId: staff._id, body: "Remember to also update the Facebook page.", internal: true, createdAt: ago(1) }] });
  await mkTicket({ organizationId: orgA._id, kind: "TICKET", title: "Contact form emails not arriving", description: "We haven't received any contact form emails since Monday.", status: "OPEN", priority: "HIGH", createdBy: clientA._id });
  await mkTicket({ organizationId: orgA._id, kind: "REQUEST", requestType: "SOCIAL_MEDIA", title: "Christmas menu post", description: "Could you prepare a post for our Christmas menu?", status: "RESOLVED", priority: "LOW", assignedTo: staff._id, createdBy: clientA._id, resolvedAt: ago(5) });
  await mkTicket({ organizationId: orgB._id, kind: "TICKET", title: "Login problem in order tool", description: "Two drivers can't log in to the order tool since the update.", status: "WAITING_FOR_CLIENT", priority: "URGENT", assignedTo: staff2._id, createdBy: clientB._id, comments: [{ authorId: staff2._id, body: "Could you send us the usernames affected?", createdAt: ago(0, 3) }] });

  const storage = getStorage();
  const welcomeKey = await storage.save(Buffer.from("Welcome to your ExploreTechify workspace (demo document).\n\nThis file demonstrates secure, organization-scoped document storage.\n"), "welcome.txt");
  await ClientDocument.create([
    { organizationId: orgA._id, name: "Welcome pack (demo).txt", category: "OTHER", fileKey: welcomeKey, mimeType: "text/plain", size: 120, uploadedBy: admin._id, isDemo: true },
    { organizationId: orgB._id, name: "Welcome pack (demo).txt", category: "OTHER", fileKey: welcomeKey, mimeType: "text/plain", size: 120, uploadedBy: admin._id, isDemo: true },
  ]);

  // ── Conversations ──
  log("Creating conversations and messages…");
  const mkConversation = async (org: typeof orgA, client: typeof clientA, assignee: typeof staff | null, subject: string, topic: string, status: string, msgs: { from: "client" | "staff"; body: string; hoursAgo: number; read?: boolean }[]) => {
    const conv = await Conversation.create({ organizationId: org._id, subject, topic, status, createdBy: client._id, assignedTo: assignee?._id, participants: [{ userId: client._id, role: "CLIENT" }, ...(assignee ? [{ userId: assignee._id, role: assignee.role }] : [])], isDemo: true });
    let last: Date = new Date();
    let lastBody = "";
    let fromClient = true;
    for (const m of msgs) {
      const sender = m.from === "client" ? client : assignee ?? owner;
      const createdAt = ago(0, m.hoursAgo);
      const readBy = m.read === false ? [sender._id] : [client._id, ...internal.map((u) => u._id)];
      await Message.create({ conversationId: conv._id, organizationId: org._id, senderId: sender._id, senderRole: sender.role, body: m.body, readBy, isDemo: true, createdAt });
      last = createdAt;
      lastBody = m.body;
      fromClient = m.from === "client";
    }
    await Conversation.updateOne({ _id: conv._id }, { $set: { lastMessageAt: last, lastMessagePreview: lastBody.slice(0, 140), lastMessageFromClient: fromClient } });
    return conv;
  };
  await mkConversation(orgA, clientA, staff, "New shop opening in Trondheim", "PROJECT", "IN_PROGRESS", [
    { from: "client", body: "Hi! We're opening our second shop on 1 December. Can you help us get it on Google Maps?", hoursAgo: 50 },
    { from: "staff", body: "Congratulations! Yes — we'll create the Google Business Profile and a location page. I've set up a project in your workspace.", hoursAgo: 47 },
    { from: "client", body: "Perfect, thank you. Do you need photos from us?", hoursAgo: 3, read: false },
  ]);
  await mkConversation(orgA, clientA, null, "Question about invoice", "BILLING", "OPEN", [{ from: "client", body: "Hello, could you resend the October invoice? We can't find it.", hoursAgo: 1, read: false }]);
  await mkConversation(orgB, clientB, staff2, "Driver accounts", "TECHNICAL_SUPPORT", "WAITING_FOR_CLIENT", [
    { from: "client", body: "Two of our drivers can't log in since yesterday.", hoursAgo: 6 },
    { from: "staff", body: "Thanks Jonas — could you send us their usernames? We'll reset them right away.", hoursAgo: 3 },
  ]);

  // ── Outreach: templates, campaigns, drafts → review → approve → send (console provider) ──
  log("Creating outreach templates and campaigns…");
  const templates = await EmailTemplate.create(DEMO_TEMPLATES.map((t) => ({ ...t, createdBy: admin._id, isDemo: true })));
  const tpl = (country: string, lang: string) => templates.find((t) => t.countryCode === country && t.languageCode === lang)!;
  await SuppressionEntry.create([
    { email: "post@optout-demo.example", reason: "OPT_OUT", source: "unsubscribe-link" },
    { domain: "do-not-contact-demo.example", reason: "DO_NOT_CONTACT", source: "manual", note: "Asked not to be contacted (demo)." },
  ]);
  const campaigns = [
    { name: "Norway — new AS without website", countryCode: "NO", languageCode: "no", templateId: tpl("NO", "no")._id, segment: { minScore: 50, requireEmail: true, stages: ["QUALIFIED", "READY_FOR_OUTREACH"], noWebsiteOnly: false } },
    { name: "Germany — Neugründungen Q4", countryCode: "DE", languageCode: "de", templateId: tpl("DE", "de")._id, segment: { minScore: 50, requireEmail: true, stages: ["QUALIFIED", "READY_FOR_OUTREACH"] } },
    { name: "UK — new Ltd companies", countryCode: "GB", languageCode: "en", templateId: tpl("GB", "en")._id, segment: { minScore: 55, requireEmail: true, stages: ["QUALIFIED"] } },
  ];
  for (const c of demoCompanies ? campaigns : []) {
    const campaign = await EmailCampaign.create({ ...c, status: "ACTIVE", createdBy: staff._id, isDemo: true });
    await generateCampaignDrafts(toActor(staff), String(campaign._id), { limit: 6 });
    const drafts = await EmailMessage.find({ campaignId: campaign._id }).sort({ createdAt: 1 }).lean();
    for (let i = 0; i < drafts.length; i++) {
      const id = String(drafts[i]!._id);
      if (i >= 4) continue; // keep some as drafts
      await submitForReview(toActor(staff), id);
      if (i >= 2) continue; // keep some in the approval queue
      await approveMessage(adminActor, id);
      await sendApprovedMessage(adminActor, id);
      if (i === 0) await markReplied(adminActor, id);
    }
  }

  // ── Website content: illustrative case studies (clearly marked as examples) ──
  log("Creating case studies, enquiries and notifications…");
  await CaseStudy.create([
    {
      slug: "local-bakery-digital-foundation",
      clientName: "Local bakery (example)",
      industry: "hospitality",
      services: ["businessWebsite", "googleBusinessProfile", "localSeo", "websiteMaintenance"],
      technologies: ["Website builder", "Google Business Profile"],
      isExample: true,
      published: true,
      sortOrder: 1,
      content: {
        title: "From no website to found locally",
        summary: "An illustrative example of how we set up and run the digital foundation for a newly opened bakery.",
        challenge: "A newly registered bakery had no website, used a personal email address and was hard to find on maps.",
        solution: "We set up a simple website, business email and Google Business Profile, then took over monthly updates and local SEO.",
        results: ["Digital foundation documented and owned by the business", "One point of contact for every digital request"],
      },
      translations: { no: { title: "Fra ingen nettside til å bli funnet lokalt", summary: "Et illustrerende eksempel på hvordan vi etablerer og drifter det digitale fundamentet for et nyåpnet bakeri." } },
    },
    {
      slug: "logistics-order-dashboard",
      clientName: "Logistics SME (example)",
      industry: "logistics",
      services: ["orderManagement", "businessDashboards", "reportingAutomation"],
      technologies: ["Internal tool", "Automated reports"],
      isExample: true,
      published: true,
      sortOrder: 2,
      content: {
        title: "Replacing spreadsheets with a simple order dashboard",
        summary: "An illustrative example of a business-systems engagement for a growing transport company.",
        challenge: "Orders were tracked in shared spreadsheets and weekly reports took hours to build.",
        solution: "We mapped the workflow, introduced a lightweight order tool and automated the weekly report.",
        results: ["Single source of truth for orders", "Weekly report generated automatically"],
      },
    },
    {
      slug: "tech-startup-hiring-support",
      clientName: "Software startup (example)",
      industry: "technology",
      services: ["technicalRecruitment", "recruitmentWorkflow", "employeeOnboarding"],
      technologies: ["Applicant tracking", "Onboarding checklist"],
      isExample: true,
      published: true,
      sortOrder: 3,
      content: {
        title: "Structured hiring for a growing tech team",
        summary: "An illustrative example of recruitment and onboarding support, with specialist recruiters coordinated where needed.",
        challenge: "The founders spent too much time on job posts, screening and setting up accounts for new hires.",
        solution: "We set up a recruitment workflow, coordinated a specialist recruiter for senior roles and created an onboarding checklist.",
        results: ["Clear hiring pipeline", "Consistent onboarding for every new employee"],
      },
    },
  ]);

  await ContactRequest.create([
    { name: "Erik Demo", company: "Fjordlys Rørlegger AS (Demo)", email: "erik@fjordlys-demo.example", countryCode: "NO", industry: "construction", need: "website", message: "We just registered our company and need a website and email. Can you help?", preferredContact: "phone", ongoingSupport: "yes", interestedServices: ["businessWebsite", "businessEmail"], locale: "no", isDemo: true },
    { name: "Lea Demo", company: "Kaffeerösterei Süd (Demo)", email: "lea@kaffee-demo.example", countryCode: "DE", industry: "retail", need: "growth", message: "Wir möchten unseren Onlineshop bekannter machen und suchen laufende Unterstützung.", preferredContact: "email", ongoingSupport: "maybe", interestedServices: ["seo", "ecommerce"], locale: "de", status: "IN_REVIEW", isDemo: true },
  ]);

  await Notification.create([
    { userId: owner._id, type: "CLIENT_SIGNUP", title: "New client signup: Lumière Studio SAS (Demo)", body: "Camille Lefèvre is awaiting approval.", link: `/dashboard/clients/${orgC._id}` },
    { userId: owner._id, type: "SYNC_COMPLETED", title: "Demo registry syncs completed for 7 countries", link: "/dashboard/settings/countries", readAt: new Date() },
    { userId: clientA._id, type: "CHAT_MESSAGE", title: "New reply from Sara Staff", link: "/portal/messages", readAt: new Date() },
  ]);
  await AuditLog.create({ actorId: owner._id, actorEmail: owner.email, actorRole: "OWNER", action: "seed.completed", metadata: { demo: true } });

  log("Demo data ready.");
  log(`Sign in with ${creds.owner} / ${creds.admin} / ${creds.staff} / ${creds.client} and the DEMO_PASSWORD${creds.password ? "" : ` (${password})`}.`);
  return { password };
}

