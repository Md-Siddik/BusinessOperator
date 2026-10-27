import { Info } from "lucide-react";

/** Plain-language summary of the access rules, shown above Permission Management. */
export function AccessPolicyNote({ delegate }: { delegate?: boolean }) {
  return (
    <details className="rounded-xl border border-sky-200 bg-sky-50 text-sm text-sky-950">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2.5 font-medium">
        <Info className="h-4 w-4 shrink-0" aria-hidden /> How access works
      </summary>
      <ul className="list-disc space-y-1 px-9 pb-4">
        <li>A role describes someone&apos;s job; it doesn&apos;t give access by itself. People see only what is switched on for them.</li>
        <li>Company Intelligence is for the Owner only and can never be shared.</li>
        <li>Sending a lead to a Digital Marketer doesn&apos;t let them see it — they also need “View Assigned Client Leads”, and they only ever see their own leads.</li>
        <li>A Super Admin can give Opportunity Intelligence to others only with both “View Opportunity Intelligence” and “Grant Opportunity Intelligence Access”. If either is removed, the access they gave is removed too; access the Owner gave directly stays.</li>
        {delegate && <li>You can&apos;t change your own access, and only the Owner can remove what the Owner granted.</li>}
        <li>Every change is recorded in the audit log with who made it and when.</li>
      </ul>
    </details>
  );
}
