import "server-only";
import type { Types } from "mongoose";
import { InboxItem, type InboxItemDoc, type InboxType } from "@/models";
import { channels, getRealtime } from "@/lib/realtime";
import { todayIn } from "@/lib/dates/country-time";
import { getCountry } from "@/config/countries";
import { getSetting } from "@/features/settings/service";

/** Add a research-inbox item (deduplicated by key, volume-limited by owner settings). */
export async function addInboxItem(item: { type: InboxType; dedupeKey: string; companyId?: Types.ObjectId | string; countryCode?: string; title: string; body?: string; priority?: number }) {
  const s = (await getSetting("research")).inbox;
  if (item.type === "NEW_CONTACTABLE" && !s.newContactable) return false;
  if (item.type === "VERIFICATION_CHANGE" && !s.verificationChanges) return false;
  if (item.type === "SERVICE_MATCH" && !s.serviceMatches) return false;
  if (item.type === "REVIEW_NEEDED" && !s.reviewNeeded) return false;
  if (item.type === "NEW_CONTACTABLE" && s.maxPerCountryPerDay > 0 && item.countryCode) {
    const tz = getCountry(item.countryCode)?.timezone ?? "UTC";
    const day = todayIn(tz);
    const since = new Date(Date.now() - 36 * 3_600_000);
    const recent = await InboxItem.find({ type: "NEW_CONTACTABLE", countryCode: item.countryCode, createdAt: { $gte: since } }).select("createdAt").lean<InboxItemDoc[]>();
    if (recent.filter((r) => todayIn(tz, r.createdAt) === day).length >= s.maxPerCountryPerDay) return false;
  }
  try {
    await InboxItem.create(item);
    return true;
  } catch {
    return false; // duplicate key — already in the inbox
  }
}

/**
 * Push a lightweight "intelligence updated" event to signed-in internal users.
 * The page decides when to refresh (never moving rows during an active interaction).
 */
export function publishIntelUpdate(event: { countryCode: string; kind: "registrations" | "contacts" | "research"; count: number; companyIds?: string[] }) {
  getRealtime().publish(channels.intel, { type: "intel.updated", ...event, at: new Date().toISOString() });
}
