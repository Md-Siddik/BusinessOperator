"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/form";
import { CONTACT_REQUEST_STATUSES } from "@/lib/constants";

export function InquiryActions({ id, manager, verified, status, quotations }: { id: string; manager: boolean; verified: boolean; status: string; quotations: { id: string; decision: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("REPLY");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  async function submit(body: unknown, method = "POST") {
    if (pending) return;
    setPending(true); setNotice("");
    try {
      const result = await apiFetch<{ saved?: boolean; emailAccepted?: boolean }>("/api/inquiries/" + id, { method, body });
      setNotice(result.saved ? (result.emailAccepted ? "Response saved; email accepted by provider." : "Response saved. Email was not confirmed by the provider. Do not assume delivery.") : "Saved.");
      router.refresh();
    } catch (err) { setNotice(err instanceof Error ? err.message : "Unable to save."); }
    finally { setPending(false); }
  }
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    void submit(manager ? { ...data, kind, ...(kind === "QUOTATION" ? { amount: Number(data.amount) } : {}) } : { body: data.body });
  }
  return <div className="space-y-5">
    {notice && <p role="status" className="text-sm text-ink-700">{notice}</p>}
    {manager && <div className="flex flex-wrap gap-3"><Select aria-label="Inquiry status" value={status} disabled={pending} onChange={(e) => void submit({ status: e.target.value }, "PATCH")}>
      {CONTACT_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
    </Select></div>}
    {!manager && quotations.filter((q) => q.decision === "PENDING").map((q, i) => <div key={q.id} className="flex flex-wrap items-center gap-3">
      <span>Quotation {i + 1}</span>
      <Button disabled={pending} onClick={() => void submit({ responseId: q.id, decision: "ACCEPTED" })}>Accept quotation</Button>
      <Button variant="outline" disabled={pending} onClick={() => void submit({ responseId: q.id, decision: "REJECTED" })}>Reject quotation</Button>
    </div>)}
    {manager && !verified ? <p className="text-sm text-amber-800">Waiting for the client to verify their inquiry email. Replies and quotations are locked.</p> : <form onSubmit={onSubmit} className="space-y-4">
      {manager && <Field label="Response type">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}><option value="REPLY">Reply</option><option value="QUOTATION">Quotation</option></Select>}</Field>}
      <Field label="Message">{(p) => <Textarea {...p} name="body" required maxLength={10000} rows={4} />}</Field>
      {manager && kind === "QUOTATION" && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount">{(p) => <Input {...p} name="amount" type="number" min={0} max={100000000} step="0.01" required />}</Field>
        <Field label="Currency">{(p) => <Select {...p} name="currency">{["USD","EUR","GBP","BDT","NOK","SEK","DKK"].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Scope of work">{(p) => <Textarea {...p} name="scope" required maxLength={5000} />}</Field>
        <Field label="Estimated delivery">{(p) => <Input {...p} name="delivery" required maxLength={200} />}</Field>
        <Field label="Payment terms">{(p) => <Textarea {...p} name="paymentTerms" required maxLength={2000} />}</Field>
        <Field label="Notes">{(p) => <Textarea {...p} name="notes" maxLength={3000} />}</Field>
      </div>}
      <Button type="submit" loading={pending}>{manager ? "Save and send response" : "Send reply"}</Button>
    </form>}
  </div>;
}
