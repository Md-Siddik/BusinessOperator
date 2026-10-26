import { getSessionUser, homeFor } from "@/lib/auth/session";
import { isActiveSessionUser, isPendingClientUser } from "@/lib/auth/actor";
import { SiteHeader, type SiteHeaderProps } from "./site-header";
import type { HeaderAuthState } from "./auth-button";

/** Uses the same live account validation as /api/auth/status. */
export async function SessionHeader(props: Omit<SiteHeaderProps, "initialAuth">) {
  let initialAuth: HeaderAuthState;
  try {
    const user = await getSessionUser();
    const signedIn = user && (isActiveSessionUser(user) || isPendingClientUser(user));
    initialAuth = signedIn ? { kind: "signed-in", home: homeFor(user.role), name: user.name, role: user.role } : { kind: "signed-out" };
  } catch {
    // An unavailable database is not evidence of a logged-out session.
    initialAuth = { kind: "unresolved" };
  }
  return <SiteHeader {...props} initialAuth={initialAuth} />;
}
