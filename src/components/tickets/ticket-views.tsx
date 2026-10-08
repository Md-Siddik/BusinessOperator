"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Lock, Paperclip, Upload } from "lucide-react";
import { PRIORITIES, REQUEST_TYPES, TICKET_STATUSES, UPLOAD_LIMITS } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import { formatBytes, formatDateTime, humanize } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/data";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

export type TicketComment = { _id: string; body: string; internal: boolean; createdAt: string; author?: { name: string; role: string } };
export type TicketAttachment = { _id: string; name: string; size?: number };

export function TicketConversation({ ticketId, comments, attachments, mode, closed }: { ticketId: string; comments: TicketComment[]; attachments: TicketAttachment[]; mode: "client" | "internal"; closed: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPending(true);
    try {
      await apiFetch(`/api/tickets/${ticketId}`, { body: { body, internal } });
      setBody("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Comment not saved");
    } finally {
      setPending(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    setPending(true);
    try {
      await apiFetch(`/api/tickets/${ticketId}`, { formData: fd });
      toast.success("Attachment uploaded");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li key={a._id}>
              <a href={`/api/tickets/${ticketId}/attachments/${a._id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50">
                <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.name} {a.size ? <span className="text-ink-400">{formatBytes(a.size)}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
      <ol className="space-y-4">
        {comments.map((c) => (
          <li key={c._id} className={cn("flex gap-3", c.internal && "rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-200")}>
            <Avatar name={c.author?.name} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{c.author?.name ?? "Team"}</span>
                {c.author?.role && c.author.role !== "CLIENT" && <span className="ml-1 text-xs text-brand-600">ExploreTechify</span>}
                <span className="ml-2 text-xs text-ink-400">{formatDateTime(c.createdAt)}</span>
                {c.internal && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
                    <Lock className="h-3 w-3" aria-hidden /> Internal note
                  </span>
                )}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{c.body}</p>
            </div>
          </li>
        ))}
        {comments.length === 0 && <li className="text-sm text-ink-500">No comments yet.</li>}
      </ol>
      {!closed && (
        <form onSubmit={submit} className="space-y-2 border-t border-ink-100 pt-4">
          <label htmlFor="comment" className="sr-only">
            Add a comment
          </label>
          <Textarea id="comment" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={mode === "client" ? "Reply to the team…" : "Reply to the client, or add an internal note…"} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-4">
              {mode === "internal" && <Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)} label="Internal note (hidden from client)" />}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900">
                <Upload className="h-4 w-4" aria-hidden /> Attach
                <input type="file" multiple hidden accept={UPLOAD_LIMITS.allowedExtensions.join(",")} onChange={(e) => void upload(e.target.files)} />
              </label>
            </div>
            <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>
              {internal ? "Add note" : "Send reply"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function TicketControls({ ticketId, status, priority, assignedTo, staff, mode, canAssign }: { ticketId: string; status: string; priority: string; assignedTo?: string; staff: { id: string; name: string }[]; mode: "client" | "internal"; canAssign: boolean }) {
  const router = useRouter();
  const toast = useToast();
  async function update(patch: Record<string, unknown>, msg = "Updated") {
    try {
      await apiFetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: patch });
      toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    }
  }
  if (mode === "client") {
    return status === "CLOSED" || status === "RESOLVED" ? (
      <Button size="sm" variant="outline" onClick={() => void update({ status: "OPEN" }, "Re-opened")}>
        Re-open
      </Button>
    ) : (
      <Button size="sm" variant="outline" onClick={() => void update({ status: "CLOSED" }, "Closed")}>
        Close
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-ink-500">Status</span>
        <Select value={status} onChange={(e) => void update({ status: e.target.value })}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-ink-500">Priority</span>
        <Select value={priority} onChange={(e) => void update({ priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </Select>
      </label>
      {canAssign && (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-500">Assigned staff</span>
          <Select value={assignedTo ?? ""} onChange={(e) => void update({ assignedTo: e.target.value || null }, "Assignment updated")}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </div>
  );
}

export function TicketCreateForm({ kind, mode, organizations = [], redirectBase, labels }: { kind: "REQUEST" | "TICKET"; mode: "client" | "internal"; organizations?: { id: string; name: string }[]; redirectBase: string; labels?: { submit?: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("kind", kind);
    setPending(true);
    setErrors({});
    setError(undefined);
    try {
      const t = await apiFetch<{ _id: string }>("/api/tickets", { formData: fd });
      router.push(`${redirectBase}/${t._id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        setError(err.message);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {mode === "internal" && (
        <Field label="Client" error={errors.organizationId}>
          {(p) => (
            <Select {...p} name="organizationId" required>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {kind === "REQUEST" && (
          <Field label="Request type" error={errors.requestType}>
            {(p) => (
              <Select {...p} name="requestType" defaultValue="WEBSITE_UPDATE">
                {REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Priority" error={errors.priority}>
          {(p) => (
            <Select {...p} name="priority" defaultValue="NORMAL">
              {PRIORITIES.map((pr) => (
                <option key={pr} value={pr}>
                  {humanize(pr)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Title" error={errors.title}>
        {(p) => <Input {...p} name="title" required maxLength={200} />}
      </Field>
      <Field label="Description" error={errors.description}>
        {(p) => <Textarea {...p} name="description" rows={6} required />}
      </Field>
      <Field label="Due date" optional="optional" error={errors.dueDate}>
        {(p) => <Input {...p} type="date" name="dueDate" />}
      </Field>
      <Field label="Attachments" optional="optional" hint="Images, PDF, Office documents or text — up to 10 MB each, max 5.">
        {(p) => <input {...p} type="file" name="files" multiple accept={UPLOAD_LIMITS.allowedExtensions.join(",")} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm" />}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {labels?.submit ?? (kind === "REQUEST" ? "Submit request" : "Open ticket")}
        </Button>
      </div>
    </form>
  );
}
