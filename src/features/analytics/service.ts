import type { PipelineStage } from "mongoose";
import { COUNTRIES } from "@/config/countries";
import { stagesFrom } from "@/lib/constants";
import { ClientService, Company, Conversation, CrmActivity, EmailMessage, Organization, SupportTicket } from "@/models";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { countryFilter } from "@/features/companies/service";
import { companyVisibilityFilter } from "@/lib/data-mode";
import { getSetting } from "@/features/settings/service";
import { unreadConversationCount } from "@/features/chat/service";

function requireAnalytics(actor: Actor) {
  if (!can(actor, "analytics.view")) throw Errors.forbidden();
}

export type Granularity = "day" | "week" | "month";

/** Acquisition + outreach funnel for a country (or ALL), with time series. */
export async function getAnalytics(actor: Actor, opts: { country: string; granularity?: Granularity; days?: number }) {
  requireAnalytics(actor);
  const match = countryFilter(opts.country);
  const days = Math.min(Math.max(opts.days ?? 90, 7), 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const granularity = opts.granularity ?? (days > 120 ? "month" : days > 31 ? "week" : "day");
  const settings = await getSetting("leadScoring");
  const fmt = granularity === "month" ? "%Y-%m" : granularity === "week" ? "%G-W%V" : "%Y-%m-%d";
  const contactable = { $or: [{ email: { $nin: [null, ""], $exists: true } }, { phone: { $nin: [null, ""], $exists: true } }] };
  const count = (extra: object): PipelineStage.FacetPipelineStage[] => [{ $match: extra }, { $count: "n" }];

  const [facets] = await Company.aggregate([
    { $match: { ...match, ...companyVisibilityFilter() } },
    {
      $facet: {
        discovered: count({}),
        qualified: count({ "lead.score": { $gte: settings.qualifiedThreshold } }),
        contactable: count(contactable),
        contacted: count({ "lead.stage": { $in: stagesFrom("CONTACTED") } }),
        replied: count({ "lead.stage": { $in: stagesFrom("REPLIED") } }),
        meetings: count({ "lead.stage": { $in: stagesFrom("MEETING") } }),
        proposals: count({ "lead.stage": { $in: stagesFrom("PROPOSAL") } }),
        clients: count({ "lead.stage": "CLIENT" }),
        availability: [
          {
            $group: {
              _id: null,
              email: { $sum: { $cond: ["$contactFlags.email", 1, 0] } },
              phone: { $sum: { $cond: [{ $or: ["$contactFlags.phone", "$contactFlags.mobile"] }, 1, 0] } },
              website: { $sum: { $cond: ["$contactFlags.website", 1, 0] } },
              person: { $sum: { $cond: ["$contactFlags.person", 1, 0] } },
              full: { $sum: { $cond: ["$fullyContactable", 1, 0] } },
            },
          },
        ],
        series: [
          { $match: { registrationDate: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: fmt, date: "$registrationDate" } },
              discovered: { $sum: 1 },
              qualified: { $sum: { $cond: [{ $gte: ["$lead.score", settings.qualifiedThreshold] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byIndustry: [
          { $group: { _id: "$industry", total: { $sum: 1 }, qualified: { $sum: { $cond: [{ $gte: ["$lead.score", settings.qualifiedThreshold] }, 1, 0] } }, avgScore: { $avg: "$lead.score" } } },
          { $sort: { total: -1 } },
        ],
        byCountry: [
          { $group: { _id: "$countryCode", total: { $sum: 1 }, qualified: { $sum: { $cond: [{ $gte: ["$lead.score", settings.qualifiedThreshold] }, 1, 0] } }, clients: { $sum: { $cond: [{ $eq: ["$lead.stage", "CLIENT"] }, 1, 0] } } } },
          { $sort: { total: -1 } },
        ],
      },
    },
  ]);
  const n = (k: string) => (facets?.[k]?.[0]?.n as number) ?? 0;

  const emailMatch = { kind: "OUTREACH", ...(match.countryCode ? { countryCode: match.countryCode } : {}) };
  const [emailAgg, emailSeries] = await Promise.all([
    EmailMessage.aggregate([{ $match: emailMatch }, { $group: { _id: "$status", n: { $sum: 1 }, replies: { $sum: { $cond: [{ $eq: ["$replyStatus", "REPLIED"] }, 1, 0] } } } }]),
    EmailMessage.aggregate([
      { $match: { ...emailMatch, sentAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: fmt, date: "$sentAt" } }, sent: { $sum: 1 }, replies: { $sum: { $cond: [{ $eq: ["$replyStatus", "REPLIED"] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const sum = (statuses: string[]) => emailAgg.filter((e) => statuses.includes(e._id)).reduce((a, e) => a + e.n, 0);

  const seriesMap = new Map<string, { period: string; discovered: number; qualified: number; sent: number; replies: number }>();
  for (const s of facets?.series ?? []) seriesMap.set(s._id, { period: s._id, discovered: s.discovered, qualified: s.qualified, sent: 0, replies: 0 });
  for (const s of emailSeries) {
    const row = seriesMap.get(s._id) ?? { period: s._id, discovered: 0, qualified: 0, sent: 0, replies: 0 };
    row.sent = s.sent;
    row.replies = s.replies;
    seriesMap.set(s._id, row);
  }

  return {
    granularity,
    days,
    acquisition: { discovered: n("discovered"), qualified: n("qualified"), contactable: n("contactable") },
    availability: {
      email: (facets?.availability?.[0]?.email as number) ?? 0,
      phone: (facets?.availability?.[0]?.phone as number) ?? 0,
      website: (facets?.availability?.[0]?.website as number) ?? 0,
      person: (facets?.availability?.[0]?.person as number) ?? 0,
      fullyContactable: (facets?.availability?.[0]?.full as number) ?? 0,
    },
    outreach: {
      drafted: emailAgg.reduce((a, e) => a + e.n, 0),
      approved: sum(["APPROVED", "SENT", "DELIVERED"]),
      sent: sum(["SENT", "DELIVERED"]),
      replies: emailAgg.reduce((a, e) => a + e.replies, 0),
      meetings: n("meetings"),
      proposals: n("proposals"),
      clients: n("clients"),
    },
    funnel: [
      { stage: "Discovered", count: n("discovered") },
      { stage: "Qualified", count: n("qualified") },
      { stage: "Contacted", count: n("contacted") },
      { stage: "Replied", count: n("replied") },
      { stage: "Meeting", count: n("meetings") },
      { stage: "Proposal", count: n("proposals") },
      { stage: "Client", count: n("clients") },
    ],
    series: [...seriesMap.values()].sort((a, b) => a.period.localeCompare(b.period)),
    byIndustry: (facets?.byIndustry ?? []).map((r: { _id: string; total: number; qualified: number; avgScore: number }) => ({ industry: r._id ?? "other", total: r.total, qualified: r.qualified, avgScore: Math.round(r.avgScore ?? 0) })) as { industry: string; total: number; qualified: number; avgScore: number }[],
    byCountry: COUNTRIES.map((c) => {
      const r = (facets?.byCountry ?? []).find((x: { _id: string }) => x._id === c.code);
      return { country: c.code, name: c.name, total: r?.total ?? 0, qualified: r?.qualified ?? 0, clients: r?.clients ?? 0 };
    }),
  };
}

/** Owner overview: what needs attention right now, across the business. */
export async function getOverview(actor: Actor, country: string) {
  const match = countryFilter(country);
  const analytics = can(actor, "analytics.view") ? await getAnalytics(actor, { country, days: 30 }) : null;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [newThisWeek, pendingApprovals, pendingClients, openTickets, activeServices, recentActivity, servicesInUse, waitingConversations] = await Promise.all([
    Company.countDocuments({ ...match, ...companyVisibilityFilter(), registrationDate: { $gte: weekAgo } }),
    EmailMessage.countDocuments({ kind: "OUTREACH", status: "PENDING_APPROVAL", ...(match.countryCode ? { countryCode: match.countryCode } : {}) }),
    Organization.countDocuments({ status: "PENDING_APPROVAL" }),
    SupportTicket.countDocuments({ status: { $in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"] } }),
    ClientService.countDocuments({ status: "ACTIVE" }),
    CrmActivity.find(match.countryCode ? { countryCode: match.countryCode } : {}).sort({ createdAt: -1 }).limit(8).populate("companyId", "companyName countryCode").populate("actorId", "name").lean(),
    ClientService.aggregate([{ $match: { status: "ACTIVE" } }, { $group: { _id: "$category", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Conversation.countDocuments({ status: { $in: ["OPEN", "IN_PROGRESS"] }, lastMessageFromClient: true }),
  ]);
  return {
    analytics,
    newThisWeek,
    pendingApprovals,
    pendingClients,
    openTickets,
    activeServices,
    recentActivity,
    servicesInUse: servicesInUse.map((s) => ({ category: s._id as string, count: s.n as number })),
    waitingConversations,
    unreadMessages: await unreadConversationCount(actor),
  };
}
