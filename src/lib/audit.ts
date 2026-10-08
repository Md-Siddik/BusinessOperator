import { AuditLog } from "@/models";
import type { Actor } from "@/lib/permissions";

export type AuditInput = {
  entityType?: string;
  entityId?: string;
  countryCode?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
};

/**
 * Record an auditable action. Never throws — auditing must not break the
 * user-facing operation — but failures are logged server-side.
 */
export async function audit(actor: Pick<Actor, "id" | "email" | "role"> | null, action: string, input: AuditInput = {}) {
  try {
    await AuditLog.create({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action,
      ...input,
    });
  } catch (err) {
    console.error("[audit] failed to record", action, err);
  }
}
