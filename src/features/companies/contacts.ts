import "server-only";
import type { FilterQuery } from "mongoose";
import { z } from "zod";
import { CONTACT_SOURCE_KINDS } from "@/lib/company-fields";
import { isDemoModeEnabled } from "@/lib/data-mode";
import { escapeRegex } from "@/lib/utils";
import { paginate } from "@/lib/validation";
import type { Actor } from "@/lib/permissions";
import { Contact, CONTACT_TYPES, type ContactDoc } from "@/models";
import { assertCanReadCompanies, countryFilter } from "./service";

const contactQuerySchema = z.object({
  country: z.string().min(2).default("ALL"),
  type: z.enum(CONTACT_TYPES).optional(),
  sourceKind: z.enum(CONTACT_SOURCE_KINDS).optional(),
  verified: z.enum(["yes", "no"]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

export type ContactListItem = ContactDoc & { companyId: { _id: string; companyName: string; countryCode: string; registrationDay?: string } | null };

/** Contact values across companies, each with its source (Research → Contacts). */
export async function listContacts(actor: Actor, input: unknown) {
  assertCanReadCompanies(actor);
  const q = contactQuerySchema.parse(input);
  const filter: FilterQuery<ContactDoc> = { ...countryFilter(q.country) };
  if (!isDemoModeEnabled()) filter.isDemo = { $ne: true };
  if (q.type) filter.type = q.type;
  if (q.sourceKind) filter.sourceKind = q.sourceKind;
  if (q.verified) filter.verified = q.verified === "yes";
  if (q.q) filter.value = new RegExp(escapeRegex(q.q), "i");
  const [items, total] = await Promise.all([
    Contact.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .populate("companyId", "companyName countryCode registrationDay")
      .lean<ContactListItem[]>(),
    Contact.countDocuments(filter),
  ]);
  return paginate(items, total, q.page, q.pageSize);
}
