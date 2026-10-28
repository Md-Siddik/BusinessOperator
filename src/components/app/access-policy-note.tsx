import { Info } from "lucide-react";

/** Plain-language summary of the access rules, shown above Permission Management. */
export function AccessPolicyNote({ delegate }: { delegate?: boolean }) {
  return (
    <details className="rounded-xl border border-sky-200 bg-sky-50 text-sm text-sky-950">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2.5 font-medium">
        <Info className="h-4 w-4 shrink-0" aria-hidden /> How access works
      </summary>
      <ul className="list-disc space-y-1 px-9 pb-4">
        <li>A role describes someone&apos;s job; it doesn&apos;t give access by itself. People see only the services switched on for them. New accounts start from their role template.</li>
        <li>Turn a service on or off with its switch, then pick exactly what the person may do (View, Edit, Export, Delete…). “Advanced permissions” shows every detail and who granted it.</li>
        <li>Company Intelligence can be shared per person (view, edit, export, delete). Its CRM, outreach and registry-sync tools, the Owner mailbox, website analytics, settings and audit logs stay with the Owner.</li>
        <li>Clients never see internal company intelligence or team data — only what is shared with their own organization.</li>
        <li>“Send to Marketer” adds a lead to the shared Digital Marketer table. Every Digital Marketer with “View Marketer Table” (part of the role template) sees the whole table and can set outreach statuses — nothing else.</li>
        <li>An Admin can pass on Opportunity or Company Intelligence (view) only while holding both the view permission and its “Grant … Access” permission. If either is removed, the access they gave is removed too; access the Owner gave directly stays.</li>
        {delegate && <li>You can&apos;t change your own access, and only the Owner can remove what the Owner granted.</li>}
        <li>Every change is enforced on the server and recorded in the audit log with who made it and when.</li>
      </ul>
    </details>
  );
}
