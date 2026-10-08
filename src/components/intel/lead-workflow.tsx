"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Check, FileText, X } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { ELIGIBILITY_LABELS, ELIGIBILITY_STATES, type EligibilityState } from "@/lib/company-fields";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setPending(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      router.refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  }
  return { pending, run, router };
}

/** Outreach eligibility — separate from contact availability; unclear cases stay "Needs review". */
export function EligibilityForm({ companyId, status, reason, at, protectedBySource, canEdit }: { companyId: string; status: EligibilityState; reason?: string; at?: string; protectedBySource: boolean; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [next, setNext] = useState<EligibilityState>(status);
  const [why, setWhy] = useState("");
  const [suppress, setSuppress] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", status === "CLEARED" ? "bg-emerald-50 text-emerald-800" : status === "NEEDS_REVIEW" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>{ELIGIBILITY_LABELS[status]}</span>
        {reason && <span className="ml-2 text-ink-600">{reason}</span>}
        {at && <span className="ml-1 text-xs text-ink-400">({new Date(at).toLocaleDateString("en-GB")})</span>}
      </p>
      <p className="text-xs text-ink-500">A published contact does not by itself permit marketing. Consider the jurisdiction, recipient type (company vs sole trader) and channel before clearing.</p>
      {protectedBySource && <p className="text-xs font-medium text-red-700">The source publishes a marketing restriction for this company — it cannot be cleared.</p>}
      {canEdit && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("elig", () => apiFetch(`/api/companies/${companyId}/eligibility`, { body: { status: next, reason: why, suppress } }), "Eligibility updated").then(() => setWhy(""));
          }}
        >
          <div className="flex gap-2">
            <Select value={next} onChange={(e) => setNext(e.target.value as EligibilityState)} aria-label="Eligibility" className="flex-1">
              {ELIGIBILITY_STATES.map((s) => (
                <option key={s} value={s} disabled={s === "CLEARED" && protectedBySource}>
                  {ELIGIBILITY_LABELS[s]}
                </option>
              ))}
            </Select>
            <Button type="submit" size="md" variant="dark" loading={pending === "elig"} disabled={why.trim().length < 3}>
              Save
            </Button>
          </div>
          <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason (e.g. B2B limited company, legitimate interest assessed)" aria-label="Reason" required />
          {(next === "DO_NOT_CONTACT" || next === "RESTRICTED") && (
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input type="checkbox" checked={suppress} onChange={(e) => setSuppress(e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
              Objection / erasure request — also add the company&apos;s email addresses to the suppression list
            </label>
          )}
        </form>
      )}
    </div>
  );
}

/** Approve / reject an ambiguous contact (review queue). */
export function ContactReviewButtons({ contactId, review }: { contactId: string; review: string }) {
  const { pending, run } = useRun();
  if (review !== "PENDING") return null;
  return (
    <span className="inline-flex gap-1">
      <button type="button" disabled={!!pending} onClick={() => void run("a", () => apiFetch(`/api/contacts/${contactId}/review`, { body: { decision: "APPROVED" } }), "Approved — counts as a direct contact now")} className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100">
        <Check className="h-3 w-3" aria-hidden /> Approve
      </button>
      <button type="button" disabled={!!pending} onClick={() => void run("r", () => apiFetch(`/api/contacts/${contactId}/review`, { body: { decision: "REJECTED" } }), "Rejected")} className="inline-flex h-6 items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 text-[11px] font-medium text-ink-600 hover:bg-ink-50">
        <X className="h-3 w-3" aria-hidden /> Reject
      </button>
    </span>
  );
}

export type SuggestionView = { packageId: string; packageName: string; observation: string; source: string; confidence: string; nextQuestion?: string; status: string; note?: string };

/** Evidence-based service suggestions — the owner accepts, rejects or edits each. */
export function ServiceFitSuggestions({ companyId, suggestions }: { companyId: string; suggestions: SuggestionView[] }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!suggestions.length) return <p className="text-sm text-ink-500">No evidence-based suggestion yet. Suggestions appear when research or registry data supports one (e.g. no website found after research, a weak audit, a hiring signal).</p>;
  const decide = (packageId: string, status: string, n?: string) => run(`${packageId}:${status}`, () => apiFetch(`/api/companies/${companyId}/service-fit`, { body: { packageId, status, note: n } }), "Saved");
  return (
    <ul className="space-y-3">
      {suggestions.map((s) => (
        <li key={s.packageId} className={cn("rounded-lg border p-3 text-sm", s.status === "REJECTED" ? "border-ink-100 opacity-60" : s.status === "ACCEPTED" ? "border-emerald-200 bg-emerald-50/40" : "border-ink-200")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-ink-900">{s.packageName}</p>
            <span className="text-xs text-ink-500">
              Confidence: {s.confidence} · {s.status.toLowerCase()}
            </span>
          </div>
          <p className="mt-1 text-ink-700">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-400">Observation </span>
            {s.observation}
          </p>
          <p className="text-xs text-ink-500">Source: {s.source}</p>
          {s.nextQuestion && <p className="mt-1 text-xs text-ink-600">Next research question: {s.nextQuestion}</p>}
          {s.note && <p className="mt-1 text-xs italic text-ink-600">Note: {s.note}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="xs" variant="outline" loading={pending === `${s.packageId}:ACCEPTED`} onClick={() => void decide(s.packageId, "ACCEPTED")}>
              Accept
            </Button>
            <Button size="xs" variant="ghost" loading={pending === `${s.packageId}:REJECTED`} onClick={() => void decide(s.packageId, "REJECTED")}>
              Reject
            </Button>
            <Button size="xs" variant="ghost" onClick={() => (setEditing(s.packageId), setNote(s.note ?? ""))}>
              Edit note
            </Button>
          </div>
          {editing === s.packageId && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void decide(s.packageId, "EDITED", note).then(() => setEditing(null));
              }}
            >
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Adjust the recommendation…" aria-label="Recommendation note" />
              <Button size="sm" type="submit">
                Save
              </Button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Create a quotation draft (only eligible recipients can be chosen). */
export function QuotationCreator({ companyId, packages, recipients, eligible, quotations }: { companyId: string; packages: { id: string; name: string }[]; recipients: { id: string; label: string }[]; eligible: boolean; quotations: { id: string; number: number; title: string; status: string }[] }) {
  const { pending, run, router } = useRun();
  const [pkg, setPkg] = useState(packages[0]?.id ?? "");
  const [recipient, setRecipient] = useState("");
  return (
    <div className="space-y-3 text-sm">
      {quotations.length > 0 && (
        <ul className="space-y-1">
          {quotations.map((q) => (
            <li key={q.id}>
              <Link href={`/dashboard/quotations/${q.id}`} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                <FileText className="h-3.5 w-3.5" aria-hidden /> #{q.number} {q.title}
              </Link>
              <span className="ml-2 text-xs text-ink-500">{q.status.replace(/_/g, " ").toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <Select value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Service package">
          <option value="">No package (blank draft)</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Recipient" disabled={!eligible || !recipients.length}>
          <option value="">{eligible ? (recipients.length ? "Choose recipient later" : "No usable direct contact yet") : "Recipient requires cleared eligibility"}</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          loading={pending === "q"}
          onClick={() =>
            void run("q", async () => {
              const q = await apiFetch<{ _id: string }>(`/api/companies/${companyId}/quotation`, { body: { packageId: pkg || undefined, recipientContactId: recipient || undefined } });
              router.push(`/dashboard/quotations/${q._id}`);
            }, "Quotation draft created")
          }
        >
          Prepare quotation draft
        </Button>
      </div>
      <p className="text-xs text-ink-500">Drafts use only confirmed company details and owner-approved prices; anything missing stays a visible placeholder. Nothing is sent from ExploreTechify.</p>
    </div>
  );
}

/** Record a manual contact attempt (phone, email, meeting …) and the next action. */
export function ContactLogForm({ companyId, phoneOnly }: { companyId: string; phoneOnly: boolean }) {
  const { pending, run } = useRun();
  const [channel, setChannel] = useState(phoneOnly ? "PHONE" : "EMAIL");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      channel,
      outcome: f.get("outcome"),
      at: f.get("at") ? new Date(String(f.get("at"))).toISOString() : undefined,
      response: String(f.get("response") ?? "") || undefined,
      nextAction: String(f.get("nextAction") ?? "") || undefined,
      nextActionAt: f.get("nextActionAt") ? new Date(String(f.get("nextActionAt"))).toISOString() : undefined,
      providedEmail: String(f.get("providedEmail") ?? "") || undefined,
    };
    const form = e.currentTarget;
    void run("log", () => apiFetch(`/api/companies/${companyId}/contact-log`, { body }), "Contact recorded").then(() => form.reset());
  }
  return (
    <form onSubmit={submit} className="grid gap-2 text-sm sm:grid-cols-2">
      <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
        <option value="PHONE">Phone call</option>
        <option value="EMAIL">Email (sent manually)</option>
        <option value="MEETING">Meeting</option>
        <option value="CONTACT_FORM">Contact form (submitted manually)</option>
        <option value="LINKEDIN">LinkedIn</option>
        <option value="OTHER">Other</option>
      </Select>
      <Select name="outcome" defaultValue="SPOKE" aria-label="Outcome">
        <option value="NO_ANSWER">No answer</option>
        <option value="LEFT_MESSAGE">Left message</option>
        <option value="SPOKE">Spoke</option>
        <option value="SENT">Sent</option>
        <option value="REPLIED">Replied</option>
        <option value="MEETING_BOOKED">Meeting booked</option>
        <option value="NOT_INTERESTED">Not interested</option>
        <option value="OTHER">Other</option>
      </Select>
      <Input name="at" type="datetime-local" aria-label="When" />
      <Input name="nextActionAt" type="datetime-local" aria-label="Next action date" />
      <Textarea name="response" rows={2} placeholder="Response / notes" className="sm:col-span-2" />
      <Input name="nextAction" placeholder="Next action (e.g. call back Tuesday)" className="sm:col-span-2" />
      {channel === "PHONE" && <Input name="providedEmail" type="email" placeholder="Email address given during the call (optional)" className="sm:col-span-2" />}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" variant="dark" loading={pending === "log"}>
          Record contact
        </Button>
      </div>
    </form>
  );
}
