import { ownerMetadata } from "@/features/opportunities/metadata";
import type { ReactNode } from "react";
import { requireOwnerPage } from "@/lib/auth/session";
import { OpportunityTabs } from "@/components/opportunities/tabs";

export const dynamic = "force-dynamic";
export const generateMetadata = ownerMetadata("Opportunity Intelligence");

/**
 * Verified Opportunity Intelligence — OWNER ONLY. Every page below this layout is
 * gated on the OWNER role server-side; ADMIN, STAFF and CLIENT receive a 404.
 * (Pages re-check through the owner-only service layer as well.)
 */
export default async function OpportunitiesLayout({ children }: { children: ReactNode }) {
  await requireOwnerPage();
  return (
    <div className="space-y-5">
      <OpportunityTabs />
      {children}
    </div>
  );
}
