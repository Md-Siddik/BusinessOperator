"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Copy, Globe2, Mail, Radar, Trash2, UserCheck } from "lucide-react";
import { FOLLOW_UP_TYPES, LEAD_STAGES, LEAD_STAGE_LABELS } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setPending(key);
    try {
      const result = await fn();
      if (success) toast.success(success);
      router.refresh();
      return result;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setPending(null);
    }
  }
  return { pending, run, toast };
}

export function LeadControls({ companyId, stage, assignedTo, users, canAssign, canManage }: { companyId: string; stage: string; assignedTo?: string; users: { id: string; name: string }[]; canAssign: boolean; canManage: boolean }) {
  const { pending, run } = useAction();
  const [note, setNote] = useState("");
  const [nextStage, setNextStage] = useState(stage);
  if (!canManage && !canAssign) return <p className="text-sm text-ink-500">This lead is assigned to a colleague. Ask a manager to reassign it if you need to work on it.</p>;
  return (
    <div className="space-y-4">
      {canManage && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("stage", () => apiFetch(`/api/crm/${companyId}/stage`, { body: { stage: nextStage, note: note || undefined } }), "Stage updated").then(() => setNote(""));
          }}
        >
          <label className="block text-xs font-medium text-ink-500" htmlFor="stage">
            Pipeline stage
          </label>
          <div className="flex gap-2">
            <Select id="stage" value={nextStage} onChange={(e) => setNextStage(e.target.value)} className="flex-1">
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
            <Button type="submit" size="md" variant="dark" loading={pending === "stage"} disabled={nextStage === stage}>
              Save
            </Button>
          </div>
          {nextStage !== stage && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note about this change" aria-label="Stage change note" />}
          {nextStage === "DO_NOT_CONTACT" && <p className="text-xs text-amber-700">The company email will be added to the suppression list.</p>}
        </form>
      )}
      {canAssign && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-ink-500" htmlFor="assignee">
            Assigned to
          </label>
          <Select id="assignee" defaultValue={assignedTo ?? ""} onChange={(e) => void run("assign", () => apiFetch(`/api/crm/${companyId}/assign`, { body: { userId: e.target.value || null } }), "Assignment updated")}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

export function ActivityComposer({ companyId }: { companyId: string }) {
  const { pending, run } = useAction();
  const [type, setType] = useState("NOTE");
  const [body, setBody] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run("activity", () => apiFetch(`/api/crm/${companyId}/activity`, { body: { type, body } }), "Saved").then(() => setBody(""));
      }}
    >
      <div className="flex gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Activity type" className="w-36">
          <option value="NOTE">Note</option>
          <option value="CALL">Call</option>
          <option value="EMAIL">Email</option>
          <option value="MEETING">Meeting</option>
          <option value="TASK">Task</option>
        </Select>
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Log a note, call or meeting…" aria-label="Activity" required />
        <Button type="submit" loading={pending === "activity"} disabled={!body.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

export function FollowUpScheduler({ companyId }: { companyId: string }) {
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [tomorrow, setTomorrow] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run("fu", () => apiFetch(`/api/crm/${companyId}/follow-up`, { body: { dueAt: fd.get("dueAt"), type: fd.get("type"), notes: fd.get("notes") || undefined, reminder: fd.get("reminder") === "on" } }), "Follow-up scheduled").then(() => setOpen(false));
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setTomorrow(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
          setOpen(true);
        }}
      >
        Schedule follow-up
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule follow-up" size="sm">
        <form onSubmit={submit} className="space-y-4" id="fu-form">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Due</span>
            <Input type="datetime-local" name="dueAt" defaultValue={tomorrow} key={tomorrow} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <Select name="type" defaultValue="EMAIL">
              {FOLLOW_UP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0) + t.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Notes</span>
            <Textarea name="notes" rows={3} />
          </label>
          <Checkbox name="reminder" defaultChecked label="Remind me (in-app notification)" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "fu"}>
              Schedule
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function FollowUpDone({ id }: { id: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="xs" variant="outline" loading={pending === "done"} onClick={() => void run("done", () => apiFetch(`/api/crm/follow-ups/${id}`, { method: "PATCH", body: { status: "DONE" } }), "Follow-up completed")}>
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Done
    </Button>
  );
}

export function IntelligenceActions({
  companyId,
  hasWebsite,
  canEdit,
  prospect,
  templates,
  hasEmail,
  canConvert,
  isClient,
}: {
  companyId: string;
  hasWebsite: boolean;
  canEdit: boolean;
  prospect?: { enabled: boolean; url?: string };
  templates: { id: string; label: string }[];
  hasEmail: boolean;
  canConvert: boolean;
  isClient: boolean;
}) {
  const { pending, run, toast } = useAction();
  const router = useRouter();
  const [draftOpen, setDraftOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [suppress, setSuppress] = useState(true);

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" className="justify-start" disabled={!hasWebsite} loading={pending === "audit"} onClick={() => void run("audit", () => apiFetch(`/api/companies/${companyId}/audit`, { body: {} }), "Website audit complete")}>
        <Radar className="h-4 w-4" aria-hidden /> Run website audit
      </Button>
      <Button variant="outline" size="sm" className="justify-start" disabled={!hasEmail || templates.length === 0} onClick={() => setDraftOpen(true)}>
        <Mail className="h-4 w-4" aria-hidden /> Draft outreach email
      </Button>
      {canEdit && (
        <div className="rounded-lg border border-ink-200 p-2.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-ink-700">
              <Globe2 className="h-4 w-4 text-ink-400" aria-hidden /> Prospect page
            </span>
            <Button size="xs" variant={prospect?.enabled ? "outline" : "secondary"} loading={pending === "prospect"} onClick={() => void run("prospect", () => apiFetch(`/api/companies/${companyId}/prospect-page`, { body: { enabled: !prospect?.enabled } }), prospect?.enabled ? "Prospect page disabled" : "Prospect page enabled")}>
              {prospect?.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
          {prospect?.enabled && prospect.url && (
            <button
              type="button"
              className="mt-2 flex w-full items-center gap-1.5 truncate text-left text-xs text-brand-700"
              onClick={() => {
                void navigator.clipboard.writeText(prospect.url!).then(() => toast.success("Link copied"));
              }}
            >
              <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{prospect.url}</span>
            </button>
          )}
        </div>
      )}
      {canConvert && !isClient && (
        <Button variant="outline" size="sm" className="justify-start" loading={pending === "convert"} onClick={() => void run("convert", async () => {
          const org = await apiFetch<{ _id: string }>(`/api/crm/${companyId}/convert`, { body: {} });
          router.push(`/dashboard/clients/${org._id}`);
        }, "Converted to client")}>
          <UserCheck className="h-4 w-4" aria-hidden /> Convert to client
        </Button>
      )}
      {canEdit && (
        <Button variant="ghost" size="sm" className="justify-start text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete company data
        </Button>
      )}

      <Modal open={draftOpen} onClose={() => setDraftOpen(false)} title="Draft outreach email" description="Creates a personalised draft from stored facts only. It must be reviewed and approved before sending." size="sm">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Template</span>
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDraftOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={pending === "draft"}
            onClick={() =>
              void run("draft", async () => {
                const msg = await apiFetch<{ _id: string }>("/api/outreach/messages", { body: { companyId, templateId: template } });
                router.push(`/dashboard/outreach/messages/${msg._id}`);
              }, "Draft created")
            }
          >
            Create draft
          </Button>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete company data" description="Removes the company, its contacts, CRM history, follow-ups and audits. This cannot be undone." size="sm">
        <Checkbox checked={suppress} onChange={(e) => setSuppress(e.target.checked)} label="Also add its email addresses to the suppression list (recommended for opt-out / erasure requests)" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending === "delete"}
            onClick={() =>
              void run("delete", async () => {
                await apiFetch(`/api/companies/${companyId}?suppress=${suppress}`, { method: "DELETE" });
                router.push("/dashboard/companies");
              }, "Company data deleted")
            }
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
