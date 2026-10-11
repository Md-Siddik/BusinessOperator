import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function DashboardNotFound() {
  return <EmptyState icon={SearchX} title="Not found" description="This record doesn't exist or you don't have access to it." action={<ButtonLink href="/staff" variant="outline">Back to workspace</ButtonLink>} className="py-24" />;
}
