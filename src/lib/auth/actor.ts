import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Organization, User, type UserDoc } from "@/models";
import { effectivePermissions, type Actor, type Role } from "@/lib/permissions";
import type { SessionPayload } from "./token";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  emailVerifiedAt?: Date | null;
  preferredLanguage?: string | null;
  organizationId?: string;
  organizationStatus?: string;
  actor: Actor;
};

export function toActor(user: Pick<UserDoc, "_id" | "role" | "permissions" | "organizationId" | "name" | "email">): Actor {
  return {
    id: String(user._id),
    role: user.role as Role,
    permissions: effectivePermissions(user.role as Role, user.permissions),
    organizationId: user.organizationId ? String(user.organizationId) : undefined,
    name: user.name,
    email: user.email,
  };
}

/** Resolve a verified session payload to the current user (any status except suspended). */
export async function loadSessionUser(payload: SessionPayload | null): Promise<SessionUser | null> {
  if (!payload || !Types.ObjectId.isValid(payload.sub)) return null;
  await connectToDatabase();
  const user = await User.findById(payload.sub).lean<UserDoc>();
  if (!user || (user.sessionVersion ?? 0) !== payload.sv) return null;
  if (user.status === "SUSPENDED") return null;

  let organizationStatus: string | undefined;
  if (user.role === "CLIENT") {
    if (!user.organizationId) return null;
    const org = await Organization.findById(user.organizationId).select("status").lean<{ status: string }>();
    if (!org || org.status === "SUSPENDED") return null;
    organizationStatus = org.status;
  }

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    preferredLanguage: user.preferredLanguage,
    organizationId: user.organizationId ? String(user.organizationId) : undefined,
    organizationStatus,
    actor: toActor(user),
  };
}

/**
 * A signed-up client still awaiting approval (account AND organization pending — never suspended).
 * Such a user may use the live chat only; every other area still requires approval.
 */
export function isPendingClientUser(u: Pick<SessionUser, "status" | "role" | "organizationStatus" | "emailVerifiedAt">) {
  return !!u.emailVerifiedAt && u.role === "CLIENT" && u.status === "PENDING_APPROVAL" && u.organizationStatus === "PENDING_APPROVAL";
}

/** A user may act (call APIs, see data) only when their account — and client org — is active. */
export function isActiveSessionUser(u: Pick<SessionUser, "status" | "role" | "organizationStatus" | "emailVerifiedAt">) {
  if (!u.emailVerifiedAt) return false;
  if (u.status !== "ACTIVE") return false;
  if (u.role === "CLIENT" && u.organizationStatus !== "ACTIVE") return false;
  return true;
}
