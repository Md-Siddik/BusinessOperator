import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { isOwner } from "@/lib/permissions";

/**
 * Page titles for the owner-only module are rendered only for the OWNER, so a
 * non-owner who requests a module URL learns nothing from the document title.
 */
export function ownerMetadata(title: string) {
  return async function generateMetadata(): Promise<Metadata> {
    const actor = await getActor();
    return isOwner(actor) ? { title, robots: { index: false, follow: false } } : { robots: { index: false, follow: false } };
  };
}
