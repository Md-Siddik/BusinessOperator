import "server-only";
import { Types } from "mongoose";
import { LeadAssignment, SystemSetting, User, type LeadAssignmentDoc, type UserDoc } from "@/models";
import { audit } from "@/lib/audit";
import { toActor } from "@/lib/auth/actor";
import { DIGITAL_MARKETER_HANDOFF_PERMISSIONS, effectivePermissions, type Role } from "@/lib/permissions";

/**
 * Migration "2026-10-marketer-table-v1" (see lib/migrations) and its exact revert.
 *
 *  1. Merge: leads used to be sent to one marketer each (a row per company + marketer). Now there
 *     is one shared table row per company. For each company the most recently worked row is kept
 *     and becomes the table row (`recipientId` → null, `formerRecipientId` recorded); its other
 *     rows are withdrawn and point to it (`mergedInto`, `mergedFromStatus`). If any row was active,
 *     the table row is active; the latest outreach status and the Owner's latest corrections win.
 *  2. Access: every active Digital Marketer gets "View Marketer Table" (an Owner grant, audited).
 * Everything changed is listed in SystemSetting "__migration.marketer-handoff-access".
 */
export const HANDOFF_MIGRATION_KEY = "__migration.marketer-handoff-access";

type Provisioned = { userId: string; grantedBy: string; permissions: string[]; at: string };
type Merged = { keptId: string; formerRecipientId: string; keptStatus: string; merged: { id: string; status: string }[] };

const workedAt = (a: LeadAssignmentDoc) => Math.max(new Date(a.outreachStatusAt ?? 0).getTime(), new Date(a.details?.editedAt ?? 0).getTime(), new Date(a.sentAt).getTime());

export async function mergeIntoMarketerTable() {
  // Per-marketer rows not merged yet (a merged row keeps its recipient and points to its table row).
  const legacy = await LeadAssignment.find({ recipientId: { $ne: null }, mergedInto: { $exists: false } }).lean<LeadAssignmentDoc[]>();
  const byCompany = new Map<string, LeadAssignmentDoc[]>();
  for (const a of legacy) byCompany.set(String(a.companyId), [...(byCompany.get(String(a.companyId)) ?? []), a]);
  const merged: Merged[] = [];
  const now = new Date();
  for (const [companyId, rows] of byCompany) {
    // A table row may already exist (sent after the change): legacy rows are merged into it.
    const existing = await LeadAssignment.findOne({ companyId: new Types.ObjectId(companyId), recipientId: null }).lean<LeadAssignmentDoc>();
    const sorted = [...rows].sort((a, b) => workedAt(b) - workedAt(a));
    const keep = existing ?? sorted[0]!;
    const others = sorted.filter((r) => String(r._id) !== String(keep._id));
    const anyActive = rows.some((r) => r.status === "ACTIVE") || keep.status === "ACTIVE";
    const latestOutreach = [keep, ...others].filter((r) => r.outreachStatus).sort((a, b) => new Date(b.outreachStatusAt ?? 0).getTime() - new Date(a.outreachStatusAt ?? 0).getTime())[0];
    const latestDetails = [keep, ...others].filter((r) => r.details?.editedAt).sort((a, b) => new Date(b.details!.editedAt!).getTime() - new Date(a.details!.editedAt!).getTime())[0];
    const set: Record<string, unknown> = { status: anyActive ? "ACTIVE" : "WITHDRAWN" };
    if (!existing) Object.assign(set, { recipientId: null, formerRecipientId: keep.recipientId });
    if (latestOutreach && String(latestOutreach._id) !== String(keep._id)) Object.assign(set, { outreachStatus: latestOutreach.outreachStatus, outreachStatusAt: latestOutreach.outreachStatusAt, outreachStatusBy: latestOutreach.outreachStatusBy });
    if (latestDetails && String(latestDetails._id) !== String(keep._id)) set.details = latestDetails.details;
    await LeadAssignment.updateOne({ _id: keep._id }, { $set: set, ...(anyActive && { $unset: { withdrawnAt: 1 } }), $push: { history: { action: "MERGED", actorId: keep.senderId, at: now } } });
    for (const o of others) {
      await LeadAssignment.updateOne({ _id: o._id }, { $set: { status: "WITHDRAWN", withdrawnAt: o.withdrawnAt ?? now, mergedInto: keep._id, mergedFromStatus: o.status }, $push: { history: { action: "MERGED", actorId: o.senderId, at: now } } });
    }
    merged.push({ keptId: String(keep._id), formerRecipientId: existing ? "" : String(keep.recipientId), keptStatus: keep.status, merged: others.map((o) => ({ id: String(o._id), status: o.status })) });
  }
  return merged;
}

export async function provisionMarketerTableAccess(role: "DIGITAL_MARKETER" | "ADMIN" = "DIGITAL_MARKETER", migration = "2026-10-marketer-table-v1") {
  const owner = await User.findOne({ role: "OWNER", status: "ACTIVE" }).sort({ createdAt: 1 }).lean<UserDoc>();
  if (!owner) return { checked: 0, provisioned: [] as Provisioned[] };
  const marketers = await User.find({ role, status: "ACTIVE" }).lean<(UserDoc & { permissionGrants?: { permission: string }[] })[]>();
  const { changeAccess } = await import("@/features/access/service");
  const actor = toActor(owner);
  const provisioned: Provisioned[] = [];
  for (const m of marketers) {
    const held = effectivePermissions(m.role as Role, m.permissions, m.permissionGrants);
    const missing = DIGITAL_MARKETER_HANDOFF_PERMISSIONS.filter((p) => !held.includes(p));
    if (!missing.length) continue;
    for (const permission of missing) await changeAccess(actor, String(m._id), { permission, action: "grant" });
    await audit(actor, "lead.handoff_access_provisioned", { entityType: "User", entityId: String(m._id), metadata: { permissions: missing, migration } });
    provisioned.push({ userId: String(m._id), grantedBy: String(owner._id), permissions: missing, at: new Date().toISOString() });
  }
  return { checked: marketers.length, provisioned };
}

export async function runMarketerTableMigration() {
  const merged = await mergeIntoMarketerTable();
  const access = await provisionMarketerTableAccess();
  await SystemSetting.updateOne({ key: HANDOFF_MIGRATION_KEY }, { $push: { "value.provisioned": { $each: access.provisioned }, "value.merged": { $each: merged } } }, { upsert: true });
  return { merged, ...access };
}

/**
 * Migration "2026-10-admin-marketer-table-v1": every active Admin gets "View Marketer Table"
 * (read-only), recorded in SystemSetting "__migration.admin-marketer-table".
 */
export const ADMIN_TABLE_MIGRATION_KEY = "__migration.admin-marketer-table";

export async function runAdminMarketerTableMigration() {
  const access = await provisionMarketerTableAccess("ADMIN", "2026-10-admin-marketer-table-v1");
  await SystemSetting.updateOne({ key: ADMIN_TABLE_MIGRATION_KEY }, { $push: { "value.provisioned": { $each: access.provisioned } } }, { upsert: true });
  return access;
}

/** Revert: remove exactly the recorded grants and undo the recorded merges. */
export async function revertPendingHandoffAccess(key = HANDOFF_MIGRATION_KEY) {
  const doc = await SystemSetting.findOne({ key }).lean<{ value?: { provisioned?: Provisioned[]; merged?: Merged[] } }>();
  const list = doc?.value?.provisioned ?? [];
  const merges = doc?.value?.merged ?? [];
  const { changeAccess } = await import("@/features/access/service");
  let reverted = 0;
  for (const p of list) {
    const owner = await User.findById(p.grantedBy).lean<UserDoc>();
    if (!owner || owner.role !== "OWNER") continue;
    for (const permission of p.permissions) {
      await changeAccess(toActor(owner), p.userId, { permission, action: "revoke" }).catch(() => undefined);
      reverted++;
    }
  }
  for (const m of merges) {
    if (m.formerRecipientId) await LeadAssignment.updateOne({ _id: m.keptId }, { $set: { recipientId: new Types.ObjectId(m.formerRecipientId), status: m.keptStatus }, $unset: { formerRecipientId: 1 } });
    for (const o of m.merged) await LeadAssignment.updateOne({ _id: o.id }, { $set: { status: o.status }, $unset: { mergedInto: 1, mergedFromStatus: 1, ...(o.status === "ACTIVE" && { withdrawnAt: 1 }) } });
  }
  // The migration stays marked as done, so the scheduler never re-applies it after a revert.
  await SystemSetting.updateOne({ key }, { $set: { "value.provisioned": [], "value.merged": [], "value.revertedAt": new Date().toISOString(), "value.reverted": { provisioned: list, merged: merges } } });
  return { accounts: list.length, reverted, merges: merges.length };
}
