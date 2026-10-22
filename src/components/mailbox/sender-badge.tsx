import Link from "next/link";
import type { SenderMatch } from "@/features/mailbox/service";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const KINDS: Record<SenderMatch["kind"], { label: string; tone: BadgeTone }> = {
  CLIENT: { label: "Client", tone: "success" },
  COMPANY: { label: "Lead", tone: "brand" },
  ENQUIRY: { label: "Enquiry", tone: "info" },
};

/** Who the sender is to us; `linked` makes it a link to their record (not inside another link). */
export function SenderBadge({ sender, linked }: { sender?: SenderMatch; linked?: boolean }) {
  if (!sender) return null;
  const k = KINDS[sender.kind];
  const badge = (
    <Badge tone={k.tone}>
      {k.label} · {sender.label}
    </Badge>
  );
  return linked ? (
    <Link href={sender.href} className="hover:opacity-80">
      {badge}
    </Link>
  ) : (
    badge
  );
}
