import { z } from "zod";
import { SUPPRESSION_REASONS } from "@/lib/constants";
import { SuppressionEntry, type SuppressionEntryDoc } from "@/models";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { can, type Actor } from "@/lib/permissions";
import { domainFromEmail, escapeRegex } from "@/lib/utils";
import { paginate, parseObjectId } from "@/lib/validation";

/** Checked before approval AND before sending. Matches the exact address or its whole domain. */
export async function checkSuppression(email: string): Promise<{ suppressed: boolean; reason?: string }> {
  const normalized = email.trim().toLowerCase();
  const domain = domainFromEmail(normalized);
  const hit = await SuppressionEntry.findOne({ $or: [{ email: normalized }, ...(domain ? [{ domain }] : [])] }).lean<SuppressionEntryDoc>();
  return hit ? { suppressed: true, reason: hit.reason } : { suppressed: false };
}

export const suppressionInputSchema = z
  .object({
    email: z.union([z.email(), z.literal("")]).optional(),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a valid domain")
      .optional()
      .or(z.literal("")),
    reason: z.enum(SUPPRESSION_REASONS).default("MANUAL"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => !!v.email || !!v.domain, { message: "Enter an email or a domain" });

export async function addSuppression(actor: Actor | null, input: unknown, source = "manual") {
  if (actor && !can(actor, "outreach.manage")) throw Errors.forbidden();
  const data = suppressionInputSchema.parse(input);
  const key = data.email ? { email: data.email.toLowerCase() } : { domain: data.domain! };
  await SuppressionEntry.updateOne(key, { $setOnInsert: { ...key, reason: data.reason, note: data.note, source, createdBy: actor?.id } }, { upsert: true });
  await audit(actor, "suppression.added", { entityType: "SuppressionEntry", metadata: { ...key, reason: data.reason, source } });
}

export async function removeSuppression(actor: Actor, id: string) {
  if (!can(actor, "outreach.approve")) throw Errors.forbidden("Only approvers can remove suppression entries.");
  const entry = await SuppressionEntry.findByIdAndDelete(parseObjectId(id)).lean<SuppressionEntryDoc>();
  if (!entry) throw Errors.notFound();
  await audit(actor, "suppression.removed", { entityType: "SuppressionEntry", entityId: id, metadata: { email: entry.email, domain: entry.domain } });
}

export async function listSuppressions(actor: Actor, opts: { q?: string; page?: number }) {
  if (!can(actor, "outreach.manage")) throw Errors.forbidden();
  const page = opts.page ?? 1;
  const filter = opts.q ? { $or: [{ email: new RegExp(escapeRegex(opts.q), "i") }, { domain: new RegExp(escapeRegex(opts.q), "i") }] } : {};
  const [items, total] = await Promise.all([
    SuppressionEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean<SuppressionEntryDoc[]>(),
    SuppressionEntry.countDocuments(filter),
  ]);
  return paginate(items, total, page, 50);
}
