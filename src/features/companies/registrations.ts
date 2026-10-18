import "server-only";
import type { FilterQuery } from "mongoose";
import { getCountry } from "@/config/countries";
import { INDUSTRY_LABELS, type IndustryKey } from "@/config/industries";
import { Company, DailyRegistrationSnapshot, RegistrySync, SuppressionEntry, type CompanyDoc, type DailyRegistrationSnapshotDoc, type RegistrySyncDoc } from "@/models";
import { audit } from "@/lib/audit";
import { CONTACT_SOURCE_LABELS, PENDING_RESEARCH_STATUSES, type ContactSourceKind } from "@/lib/company-fields";
import { companyVisibilityFilter } from "@/lib/data-mode";
import { addDays, eachDay, resolveDayRange, startOfMonth, todayIn, type Day, type DayRange } from "@/lib/dates/country-time";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { getEnabledCountries, getRunningSync, type CountryView } from "@/features/countries/service";
import { DATA_FRESHNESS_LABELS, type DataFreshness } from "@/features/registry/types";
import { sortCountries, type CountryCoverage } from "@/lib/integration-state";
import { ALL, assertCanReadCompanies, buildCompanyFilter, companyQuerySchema, registrationDayFilter, sortFor } from "./service";

type DayStats = { total: number; withEmail: number; withPhone: number; withWebsite: number; withPerson: number; fullyContactable: number; withDirect: number };
const EMPTY: DayStats = { total: 0, withEmail: 0, withPhone: 0, withWebsite: 0, withPerson: 0, fullyContactable: 0, withDirect: 0 };

function add(a: DayStats, s: Pick<DailyRegistrationSnapshotDoc, "newCompanies" | "withEmail" | "withPhone" | "withWebsite" | "withContactPerson" | "fullyContactable"> & { withDirectContact?: number | null }): DayStats {
  return {
    total: a.total + (s.newCompanies ?? 0),
    withEmail: a.withEmail + (s.withEmail ?? 0),
    withPhone: a.withPhone + (s.withPhone ?? 0),
    withWebsite: a.withWebsite + (s.withWebsite ?? 0),
    withPerson: a.withPerson + (s.withContactPerson ?? 0),
    fullyContactable: a.fullyContactable + (s.fullyContactable ?? 0),
    withDirect: a.withDirect + (s.withDirectContact ?? 0),
  };
}

/** Research / verification counts for the selected window (new entities only). */
export type ResearchStats = {
  directContacts: number;
  verifiedEmails: number;
  publishedPhones: number;
  pendingResearch: number;
  formOnly: number;
  needsReview: number;
  /** Usable direct email (same basis as directContacts). */
  withEmail: number;
  withWebsite: number;
  withPerson: number;
};
const EMPTY_RESEARCH: ResearchStats = { directContacts: 0, verifiedEmails: 0, publishedPhones: 0, pendingResearch: 0, formOnly: 0, needsReview: 0, withEmail: 0, withWebsite: 0, withPerson: 0 };

async function researchStats(filter: FilterQuery<CompanyDoc>): Promise<ResearchStats> {
  const [r] = await Company.aggregate<ResearchStats>([
    { $match: { ...filter, eventType: { $in: ["NEW_ENTITY", null] } } },
    {
      $group: {
        _id: null,
        directContacts: { $sum: { $cond: ["$directContact.has", 1, 0] } },
        verifiedEmails: { $sum: { $cond: [{ $eq: ["$directContact.emailVerification", "DELIVERABLE"] }, 1, 0] } },
        publishedPhones: { $sum: { $cond: ["$directContact.hasPhone", 1, 0] } },
        formOnly: { $sum: { $cond: ["$directContact.formOnly", 1, 0] } },
        pendingResearch: { $sum: { $cond: [{ $in: [{ $ifNull: ["$research.status", "NOT_STARTED"] }, PENDING_RESEARCH_STATUSES] }, 1, 0] } },
        needsReview: { $sum: { $cond: ["$directContact.pendingVerification", 1, 0] } },
        withEmail: { $sum: { $cond: ["$directContact.hasEmail", 1, 0] } },
        withWebsite: { $sum: { $cond: ["$contactFlags.website", 1, 0] } },
        withPerson: { $sum: { $cond: ["$contactFlags.person", 1, 0] } },
      },
    },
  ]);
  return r ? { ...EMPTY_RESEARCH, ...r } : EMPTY_RESEARCH;
}

export type CountryCard = {
  code: string;
  slug: string;
  name: string;
  flag: string;
  state: CountryView["state"];
  stateMessage?: string;
  freshness?: DataFreshness;
  sourceName?: string;
  isDemo: boolean;
  /** Null when the source can't provide daily counts or today hasn't been synced yet. */
  today: number | null;
  todayDay: Day;
  lastSuccessAt?: Date | null;
  lastSyncAt?: Date | null;
  lastSyncStatus?: string | null;
  /** Real adapter with a daily feed (not a catalogue placeholder). */
  adapterReady: boolean;
  /** The adapter's source is a paid commercial service. */
  paid: boolean;
  /** New registrations of the last COVERAGE_DAYS days and their contact availability (from snapshots). */
  coverage: CountryCoverage;
};

/** Window used to rank countries by recent data and contact coverage. */
export const COVERAGE_DAYS = 30;

/**
 * Recent-registration + contact coverage per country in ONE aggregate over the daily
 * snapshots (a few documents per country and day — never a scan of the companies).
 */
async function coverageByCountry(countries: CountryView[]) {
  const from = countries.reduce<Day>((min, c) => {
    const d = addDays(todayIn(c.timezone), -(COVERAGE_DAYS - 1));
    return d < min ? d : min;
  }, "9999-12-31");
  const rows = await DailyRegistrationSnapshot.aggregate<{ _id: { code: string; demo: boolean }; total: number; email: number; phone: number; website: number; person: number; direct: number }>([
    { $match: { countryCode: { $in: countries.map((c) => c.code) }, date: { $gte: from } } },
    {
      $group: {
        _id: { code: "$countryCode", demo: "$isDemo" },
        total: { $sum: "$newCompanies" },
        email: { $sum: "$withEmail" },
        phone: { $sum: "$withPhone" },
        website: { $sum: "$withWebsite" },
        person: { $sum: "$withContactPerson" },
        direct: { $sum: { $ifNull: ["$withDirectContact", 0] } },
      },
    },
  ]);
  const map = new Map(rows.map((r) => [`${r._id.code}:${!!r._id.demo}`, r]));
  return (c: CountryView): CountryCoverage => {
    const r = map.get(`${c.code}:${c.isDemo}`);
    return { days: COVERAGE_DAYS, total: r?.total ?? 0, withEmail: r?.email ?? 0, withPhone: r?.phone ?? 0, withWebsite: r?.website ?? 0, withPerson: r?.person ?? 0, withDirect: r?.direct ?? 0 };
  };
}

/** Counts for one country over a set of days, from snapshots. Missing snapshot = not synced = unknown. */
async function snapshotsFor(country: CountryView, from: Day, to: Day) {
  const docs = await DailyRegistrationSnapshot.find({ countryCode: country.code, isDemo: country.isDemo, date: { $gte: from, $lte: to } }).lean<DailyRegistrationSnapshotDoc[]>();
  return new Map(docs.map((d) => [d.date, d]));
}

function sumDays(map: Map<string, DailyRegistrationSnapshotDoc>, days: Day[]): { stats: DayStats; covered: number } {
  let stats = EMPTY;
  let covered = 0;
  for (const d of days) {
    const s = map.get(d);
    if (!s) continue;
    covered++;
    stats = add(stats, s);
  }
  return { stats, covered };
}

/**
 * Country cards for the selector / overview: today's count only when the source supports it
 * and today was synced. Ordered by data availability (live + contactable first), computed
 * from source health and snapshot statistics — never a fixed list.
 */
export async function listCountryCards(actor: Actor): Promise<CountryCard[]> {
  assertCanReadCompanies(actor);
  const countries = await getEnabledCountries();
  const coverageOf = await coverageByCountry(countries);
  const cards = await Promise.all(
    countries.map(async (c) => {
      const today = todayIn(c.timezone);
      const snap = c.dailyFeed ? await DailyRegistrationSnapshot.findOne({ countryCode: c.code, isDemo: c.isDemo, date: today }).lean<DailyRegistrationSnapshotDoc>() : null;
      return {
        code: c.code,
        slug: c.slug,
        name: c.name,
        flag: c.flag,
        state: c.state,
        stateMessage: c.stateMessage,
        freshness: c.provider?.freshness,
        sourceName: c.provider?.sourceName,
        isDemo: c.isDemo,
        today: snap ? snap.newCompanies : null,
        todayDay: today,
        lastSuccessAt: c.lastSuccessAt,
        lastSyncAt: c.lastSyncAt,
        lastSyncStatus: c.lastSyncStatus,
        adapterReady: !!c.provider && !c.provider.catalogueState && c.provider.capabilities.supportsDailyRegistrations,
        paid: c.provider?.accessType === "COMMERCIAL",
        coverage: coverageOf(c),
      };
    }),
  );
  return sortCountries(cards);
}

export type RegistrationOverview = {
  country: string;
  view?: CountryView;
  range: DayRange;
  /** Whole-window counts (unfiltered). `total` null when no day in the window has been synced. */
  selected: DayStats & { known: boolean; coveredDays: number; totalDays: number; sourceTotal?: number; complete: boolean };
  quick: { today: number | null; yesterday: number | null; last7: number | null; month: number | null };
  timeline: { date: Day; count: number | null }[];
  lastSync: RegistrySyncDoc | null;
  running: RegistrySyncDoc | null;
  research: ResearchStats;
  /** Today in each country's timezone: registered vs first received vs contacts found. */
  views: { registered: number | null; received: number; contactsFound: number };
};

/**
 * Header numbers for the daily workspace: TODAY first, then yesterday / 7 days / month,
 * plus a 14-day timeline. Unfiltered — they describe the registry, not the current filters.
 */
export async function getRegistrationOverview(actor: Actor, countryParam: string, preset?: string, from?: string, to?: string): Promise<RegistrationOverview> {
  assertCanReadCompanies(actor);
  const code = countryParam.toUpperCase();
  const countries = (await getEnabledCountries()).filter((c) => c.dailyFeed);
  const selectedCountries = code === ALL ? countries : countries.filter((c) => c.code === code);
  const view = code === ALL ? undefined : (await getEnabledCountries()).find((c) => c.code === code);
  if (code !== ALL && !view) throw Errors.notFound("Country not enabled");
  const tz = getCountry(code === ALL ? "NO" : code)!.timezone;
  const range = resolveDayRange(tz, preset, from, to);

  let selected: RegistrationOverview["selected"] = { ...EMPTY, known: false, coveredDays: 0, totalDays: 0, complete: true };
  const quick = { today: null as number | null, yesterday: null as number | null, last7: null as number | null, month: null as number | null };
  const timelineMap = new Map<Day, number | null>();
  const anchorToday = todayIn(tz);
  const timelineDays = eachDay(addDays(anchorToday, -13), anchorToday);
  for (const d of timelineDays) timelineMap.set(d, null);

  for (const c of selectedCountries) {
    const today = todayIn(c.timezone);
    const r = resolveDayRange(c.timezone, preset, from, to);
    const windowFrom = [addDays(today, -30), startOfMonth(today), r.from ?? today].sort()[0]!;
    const map = await snapshotsFor(c, windowFrom, today);
    const q = (days: Day[]) => {
      const s = sumDays(map, days);
      return s.covered ? s.stats.total : null;
    };
    const merge = (cur: number | null, v: number | null) => (v === null ? cur : (cur ?? 0) + v);
    quick.today = merge(quick.today, q([today]));
    quick.yesterday = merge(quick.yesterday, q([addDays(today, -1)]));
    quick.last7 = merge(quick.last7, q(eachDay(addDays(today, -6), today)));
    quick.month = merge(quick.month, q(eachDay(startOfMonth(today), today)));
    for (const d of timelineDays) {
      const s = map.get(d);
      if (s) timelineMap.set(d, (timelineMap.get(d) ?? 0) + s.newCompanies);
    }
    if (r.from && r.to) {
      const days = eachDay(r.from, r.to);
      const extra = r.from < windowFrom ? await snapshotsFor(c, r.from, r.to) : map;
      const s = sumDays(extra, days);
      const single = days.length === 1 ? extra.get(days[0]!) : undefined;
      selected = {
        ...add(selected, { newCompanies: s.stats.total, withEmail: s.stats.withEmail, withPhone: s.stats.withPhone, withWebsite: s.stats.withWebsite, withContactPerson: s.stats.withPerson, fullyContactable: s.stats.fullyContactable, withDirectContact: s.stats.withDirect }),
        known: selected.known || s.covered > 0,
        coveredDays: selected.coveredDays + s.covered,
        totalDays: selected.totalDays + days.length,
        sourceTotal: single?.sourceTotal ?? undefined,
        complete: selected.complete && [...days].every((d) => extra.get(d)?.complete !== false),
      };
    }
  }

  if (!range.from || !range.to) {
    // "All dates": exact count from the collection.
    const filter: FilterQuery<CompanyDoc> = { ...(code === ALL ? { countryCode: { $in: selectedCountries.map((c) => c.code) } } : { countryCode: code }), ...companyVisibilityFilter() };
    const [agg] = await Company.aggregate<{ n: number; email: number; phone: number; website: number; person: number; full: number; direct: number }>([
      { $match: { ...filter, eventType: { $in: ["NEW_ENTITY", null] } } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          email: { $sum: { $cond: ["$contactFlags.email", 1, 0] } },
          phone: { $sum: { $cond: [{ $or: ["$contactFlags.phone", "$contactFlags.mobile"] }, 1, 0] } },
          website: { $sum: { $cond: ["$contactFlags.website", 1, 0] } },
          person: { $sum: { $cond: ["$contactFlags.person", 1, 0] } },
          full: { $sum: { $cond: ["$fullyContactable", 1, 0] } },
          direct: { $sum: { $cond: ["$directContact.has", 1, 0] } },
        },
      },
    ]);
    selected = { total: agg?.n ?? 0, withEmail: agg?.email ?? 0, withPhone: agg?.phone ?? 0, withWebsite: agg?.website ?? 0, withPerson: agg?.person ?? 0, fullyContactable: agg?.full ?? 0, withDirect: agg?.direct ?? 0, known: true, coveredDays: 0, totalDays: 0, complete: true };
  }

  const companyFilter: FilterQuery<CompanyDoc> = { ...(code === ALL ? { countryCode: { $in: selectedCountries.map((c) => c.code) } } : { countryCode: code }), ...companyVisibilityFilter() };
  const windowFilter = { ...companyFilter, ...registrationDayFilter(code, preset, from, to) };
  const [research, receivedToday, contactsToday] = await Promise.all([
    researchStats(windowFilter),
    Company.countDocuments({ ...companyFilter, ...registrationDayFilter(code, "today", undefined, undefined, new Date(), "received") }),
    Company.countDocuments({ ...companyFilter, ...registrationDayFilter(code, "today", undefined, undefined, new Date(), "contacts") }),
  ]);

  const [lastSync, running] =
    code === ALL
      ? [null, null]
      : await Promise.all([RegistrySync.findOne({ countryCode: code, status: { $ne: "RUNNING" } }).sort({ startedAt: -1 }).lean<RegistrySyncDoc>(), getRunningSync(code)]);

  return {
    country: code,
    view,
    range,
    selected,
    quick,
    timeline: timelineDays.map((d) => ({ date: d, count: timelineMap.get(d) ?? null })).reverse(),
    lastSync: lastSync ?? null,
    running: running ?? null,
    research,
    views: { registered: quick.today, received: receivedToday, contactsFound: contactsToday },
  };
}

/* ───────────────────────── Export ───────────────────────── */

const EXPORT_MAX = 10_000;

/** CSV cell: quoted, and neutralized against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d[\d ]{5,}$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const sourceLabel = (meta: { kind?: string | null; source?: string | null } | null | undefined) =>
  meta?.kind ? `${CONTACT_SOURCE_LABELS[meta.kind as ContactSourceKind] ?? meta.kind}${meta.source ? ` (${meta.source})` : ""}` : "";

/** Export the filtered list exactly as loaded from the database (permission companies.export). */
export async function exportCompanies(actor: Actor, input: unknown) {
  assertCanReadCompanies(actor);
  if (!can(actor, "companies.export")) throw Errors.forbidden("You don't have permission to export company data.");
  const raw = input as Record<string, unknown>;
  const approvedOnly = raw.approved === "yes";
  const q = companyQuerySchema.parse({ ...raw, page: 1, pageSize: 200, ...(approvedOnly && { eligibility: "CLEARED" }) });
  const filter = buildCompanyFilter(actor, q);
  const rows = await Company.find(filter).sort(sortFor(q.sort)).limit(EXPORT_MAX).lean<CompanyDoc[]>();
  // Restrictions apply to exports too: suppressed / restricted contacts are withheld.
  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  const domains = emails.map((e) => e.split("@")[1]!);
  const suppressed = await SuppressionEntry.find({ $or: [{ email: { $in: emails } }, { domain: { $in: domains } }] }).select("email domain").lean<{ email?: string; domain?: string }[]>();
  const isSuppressed = (email?: string | null) => !!email && suppressed.some((x) => x.email === email || (x.domain && email.endsWith(`@${x.domain}`)));
  const withheld = (c: CompanyDoc) => c.eligibility?.status === "DO_NOT_CONTACT" || c.eligibility?.status === "RESTRICTED" || c.marketingProtected;
  const header = [
    "Company",
    "Registration number",
    "Registration date",
    "Country",
    "Legal form",
    "Status",
    "Industry",
    "Industry code",
    "Address",
    "Postal code",
    "City",
    "Email",
    "Email source",
    "Phone",
    "Phone source",
    "Mobile",
    "Website",
    "Website source",
    "Contact person",
    "Contact person role",
    "Contact completeness %",
    "Direct contact",
    "Email verification",
    "Research status",
    "Outreach eligibility",
    "Suggested services",
    "Marketing protected",
    "Source",
    "Data freshness",
    "Last fetched",
    "Source record",
    "Demo data",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const c of rows) {
    const hold = withheld(c);
    const reason = hold ? `Withheld (${c.eligibility?.status === "DO_NOT_CONTACT" ? "do not contact" : "restricted"})` : "";
    const emailOut = hold ? reason : isSuppressed(c.email) ? "Withheld (suppression list)" : c.email;
    lines.push(
      [
        c.companyName,
        c.registrationNumber,
        c.registrationDay,
        c.countryName ?? c.countryCode,
        c.legalForm,
        c.status,
        c.industryDescription ?? INDUSTRY_LABELS[(c.industry ?? "other") as IndustryKey],
        c.industryCode,
        c.address,
        c.postalCode,
        c.city,
        emailOut,
        sourceLabel(c.contactSources?.email),
        hold ? reason : c.phone,
        sourceLabel(c.contactSources?.phone),
        hold ? reason : c.mobile,
        c.website,
        sourceLabel(c.contactSources?.website),
        c.contactPerson?.name,
        c.contactPerson?.role,
        c.completeness,
        c.directContact?.has ? "yes" : "no",
        c.directContact?.emailVerification ?? "",
        c.research?.status ?? "NOT_STARTED",
        c.eligibility?.status ?? "NEEDS_REVIEW",
        (c.serviceFit?.suggestions ?? []).filter((x) => x.status !== "REJECTED").map((x) => x.packageName).join("; "),
        c.marketingProtected ? "yes" : "",
        c.sourceName ?? c.source,
        c.dataFreshness ? DATA_FRESHNESS_LABELS[c.dataFreshness as DataFreshness] : "",
        c.sourceFetchedAt,
        c.sourceUrl,
        c.isDemo ? "yes" : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(actor, "companies.exported", { metadata: { country: q.country, range: q.range, view: q.view, approvedOnly, rows: rows.length, truncated: rows.length >= EXPORT_MAX } });
  // BOM so Excel opens UTF-8 (Ø, Å, Ä…) correctly.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: rows.length, truncated: rows.length >= EXPORT_MAX };
}
