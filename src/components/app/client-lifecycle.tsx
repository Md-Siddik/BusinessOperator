"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceBase } from "@/hooks/use-workspace-base";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

type Identity = { id: string; name: string; email: string | null; company: string; status: string; users: { id: string; name: string; email: string; role: string; status: string }[] };
type Review = { token: string; identity: Identity; impact?: Record<string, number | boolean>; step: 1 | 2 | 3 };

export function DeleteClient({ id }: { id: string }) {
  const router = useRouter();
  const base = useWorkspaceBase();
  const toast = useToast();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedId, setTypedId] = useState("");
  const [error, setError] = useState("");
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not complete this step. Retry or cancel and restart the review."); }
    finally { lock.current = false; setBusy(false); }
  }
  function start() {
    setReview(null); setAcknowledged(false); setTypedId(""); setOpen(true);
    void run(async () => { setReview(await apiFetch<Review>(`/api/clients/${id}/deletion`, { body: { action: "start" } })); });
  }
  async function cancel() {
    if (lock.current) return;
    if (review) await apiFetch(`/api/clients/${id}/deletion`, { body: { action: "cancel", token: review.token } }).catch(() => undefined);
    setOpen(false); setReview(null); setAcknowledged(false); setTypedId(""); setError("");
  }
  function next() {
    if (!review || (review.step === 2 && !acknowledged)) return;
    void run(async () => {
      const next = await apiFetch<Omit<Review, "token">>(`/api/clients/${id}/deletion`, { body: review.step === 1 ? { action: "review", token: review.token } : { action: "acknowledge", token: review.token, acknowledged: true } });
      setReview({ ...next, token: review.token });
    });
  }
  function remove() {
    if (!review || review.step !== 3 || !acknowledged || typedId !== review.identity.id || review.identity.id !== id) return;
    void run(async () => {
      await apiFetch(`/api/clients/${id}`, { method: "DELETE", body: { token: review.token, confirmId: typedId, acknowledged: true } });
      toast.success(`Client ${review.identity.name} (${id}) deleted. Historical records retained.`);
      setReview(null); setOpen(false); router.push(`${base}/clients`); router.refresh();
    });
  }
  return <>
    <Button size="sm" variant="outline" disabled={busy} onClick={start}>Delete Client</Button>
    <Modal open={open} onClose={() => void cancel()} dismissible={!busy} title={`Delete Client — Step ${review?.step ?? 1} of 3`} size="lg">
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      {!review ? <p>{busy ? "Loading client identity…" : "Cancel and reopen to start a new review."}</p> : <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>Client name</dt><dd className="font-medium">{review.identity.name}</dd>
          <dt>Client ID</dt><dd className="break-all font-mono">{review.identity.id}</dd>
          <dt>Email</dt><dd>{review.identity.email || "Not provided"}</dd>
          <dt>Company</dt><dd>{review.identity.company}</dd>
          <dt>Status</dt><dd>{review.identity.status}</dd>
        </dl>
        <div><p className="font-medium">Associated accounts ({review.identity.users.length})</p>
          {review.identity.users.length ? <ul className="mt-1 space-y-1">{review.identity.users.map((u) => <li key={u.id}>{u.name} · {u.email} · {u.role} · {u.status}</li>)}</ul> : <p>No associated User account.</p>}
        </div>
        {review.step >= 2 && <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <p>Deleting this client removes it from active client management and clears its profile details. Linked client accounts lose access and are signed out. Historical work and its Client ID references remain retained. Other users and business records are not deleted.</p>
          <ul>{Object.entries(review.impact ?? {}).filter(([, n]) => typeof n === "number").map(([label, count]) => <li key={label}>{label}: {count}</li>)}</ul>
          {review.step === 2 && <Checkbox label="I acknowledge the deletion impact and retained historical records." checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />}
        </div>}
        {review.step === 3 && <Field label="Type the exact Client ID to confirm" hint="This permanently removes this client from active management. A new client receives a new ID.">{(p) => <Input {...p} autoComplete="off" value={typedId} disabled={busy} onChange={(e) => setTypedId(e.target.value)} />}</Field>}
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel</Button>
        {review?.step === 1 && <Button loading={busy} onClick={next}>Continue to Step 2</Button>}
        {review?.step === 2 && <Button loading={busy} disabled={!acknowledged} onClick={next}>Continue to Final Confirmation</Button>}
        {review?.step === 3 && <Button loading={busy} disabled={!acknowledged || typedId !== review.identity.id || review.identity.id !== id} onClick={remove}>Permanently Delete Client</Button>}
      </div>
    </Modal>
  </>;
}

export function NewClient() {
  const router = useRouter();
  const base = useWorkspaceBase();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    lock.current = true; setBusy(true);
    try {
      const result = await apiFetch<{ id: string }>("/api/clients", { body });
      toast.success("Client created"); setOpen(false); router.push(`${base}/clients/${result.id}`); router.refresh();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Could not create client."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>New client</Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="New client" size="sm">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Client / company name">{(p) => <Input {...p} name="name" required minLength={2} maxLength={200} />}</Field>
        <Field label="Email" optional="optional">{(p) => <Input {...p} name="email" type="email" />}</Field>
        <Field label="Phone" optional="optional">{(p) => <Input {...p} name="phone" />}</Field>
        <Field label="Website" optional="optional">{(p) => <Input {...p} name="website" />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Create client</Button></div>
      </form>
    </Modal>
  </>;
}
