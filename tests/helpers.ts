import { ZodError } from "zod";
import { Organization, User } from "@/models";
import { toActor } from "@/lib/auth/actor";
import { ROLE_DEFAULT_PERMISSIONS, type Actor, type Permission, type Role } from "@/lib/permissions";

let n = 0;

export async function makeOrg(name = `Org ${++n}`, status: "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" = "ACTIVE") {
  return Organization.create({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${++n}`, status, countryCode: "NO" });
}

export async function makeUser(role: Role, opts: { organizationId?: unknown; permissions?: Permission[]; status?: string; name?: string } = {}) {
  const user = await User.create({
    name: opts.name ?? `${role} ${++n}`,
    email: `${role.toLowerCase()}-${++n}-${Date.now()}@test.local`,
    passwordHash: "not-used-in-service-tests",
    role,
    status: opts.status ?? "ACTIVE",
    organizationId: opts.organizationId,
    permissions: opts.permissions ?? ROLE_DEFAULT_PERMISSIONS[role],
  });
  return { user, actor: toActor(user) as Actor };
}

/** Two isolated client organizations plus internal users — the core fixture for isolation tests. */
export async function makeTenants() {
  const orgA = await makeOrg("Client A");
  const orgB = await makeOrg("Client B");
  const clientA = await makeUser("CLIENT", { organizationId: orgA._id, permissions: [] });
  const clientB = await makeUser("CLIENT", { organizationId: orgB._id, permissions: [] });
  const owner = await makeUser("OWNER");
  const admin = await makeUser("ADMIN");
  const staff = await makeUser("STAFF");
  return { orgA, orgB, clientA, clientB, owner, admin, staff };
}

export async function expectRejects(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (e) {
    // Zod validation errors are mapped to HTTP 400 by the API layer.
    const s = e instanceof ZodError ? 400 : (e as { status?: number }).status;
    if (s !== status) throw new Error(`Expected status ${status}, got ${s ?? String(e)}`);
    return;
  }
  throw new Error(`Expected rejection with status ${status}, but it resolved`);
}
