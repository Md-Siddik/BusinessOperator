"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Ban, CheckCircle2, Plus, Upload, UserPlus } from "lucide-react";
import { SERVICE_CATEGORIES } from "@/config/services";
import { CLIENT_SERVICE_STATUSES, CONTACT_REQUEST_STATUSES, DOCUMENT_CATEGORIES, PROJECT_STATUSES } from "@/lib/constants";
import { apiFetch, ApiError } from "@/lib/api/client";
import { humanize } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  async function run<T>(key: string, fn: () => Promise<T>, success?: string) {
    setPending(key);
    setErrors({});
    try {
      const r = await fn();
      if (success) toast.success(success);
      router.refresh();
      return r;
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors ?? {});
      toast.error(e instanceof ApiError ? e.message : "Something went wrong");
      return undefined;
    } finally {
      setPending(null);
    }
  }
  return { pending, errors, run, router };
}

export function OrgStatusActions({ id, status }: { id: string; status: string }) {
  const { pending, run } = useRun();
  const set = (s: "ACTIVE" | "SUSPENDED", msg: string) => run(s, () => apiFetch(`/api/clients/${id}/status`, { body: { status: s } }), msg);
  return (
    <div className="flex gap-2">
      {status !== "ACTIVE" && (
        <Button size="sm" loading={pending === "ACTIVE"} onClick={() => void set("ACTIVE", status === "PENDING_APPROVAL" ? "Client approved — welcome email sent" : "Client reactivated")}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {status === "PENDING_APPROVAL" ? "Approve" : "Reactivate"}
        </Button>
      )}
      {status !== "SUSPENDED" && (
        <Button size="sm" variant="outline" loading={pending === "SUSPENDED"} onClick={() => confirm("Suspend this client? All their users will be signed out.") && void set("SUSPENDED", "Client suspended")}>
          <Ban className="h-4 w-4" aria-hidden /> Suspend
        </Button>
      )}
    </div>
  );
}

export function AddClientUser({ orgId }: { orgId: string }) {
  const { pending, errors, run } = useRun();
  const [open, setOpen] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run("user", () => apiFetch(`/api/clients/${orgId}/users`, { body: Object.fromEntries(fd.entries()) }), "Invitation sent").then((r) => r && setOpen(false));
  }
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden /> Add user
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add client user" description="They receive an email link to set their own password." size="sm">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} name="name" required />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(p) => <Input {...p} name="email" type="email" required />}
          </Field>
          <Field label="Phone" optional="optional" error={errors.phone}>
            {(p) => <Input {...p} name="phone" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "user"}>
              Send invitation
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ClientServiceEditor({ orgId, service }: { orgId: string; service?: { id: string; category: string; name: string; status: string; notes?: string } }) {
  const { pending, errors, run } = useRun();
  const [open, setOpen] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run("svc", () => apiFetch(`/api/clients/${orgId}/services`, { body: { serviceId: service?.id, category: fd.get("category"), name: fd.get("name"), status: fd.get("status"), notes: fd.get("notes") || undefined } }), "Service saved").then((r) => r !== undefined && setOpen(false));
  }
  return (
    <>
      {service ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-brand-700 hover:text-brand-800">
          Edit
        </button>
      ) : (
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add service
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={service ? "Edit service" : "Add service"} size="sm">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Service area" error={errors.category}>
            {(p) => (
              <Select {...p} name="category" defaultValue={service?.category ?? SERVICE_CATEGORIES[0].slug}>
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {humanize(c.slug.replace(/-/g, "_"))}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} name="name" defaultValue={service?.name} required placeholder="e.g. Website Maintenance" />}
          </Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} name="status" defaultValue={service?.status ?? "ACTIVE"}>
                {CLIENT_SERVICE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes" optional="optional">
            {(p) => <Textarea {...p} name="notes" rows={3} defaultValue={service?.notes} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "svc"}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DocumentUpload({ orgId, internal }: { orgId: string; internal: boolean }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (internal) fd.set("visibleToClient", fd.get("visibleToClient") === "on" ? "true" : "false");
    void run("doc", () => apiFetch(`/api/clients/${orgId}/documents`, { formData: fd }), "Document uploaded").then((r) => r && setOpen(false));
  }
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" aria-hidden /> Upload
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload document" description="Stored securely; only your organization and the ExploreTechify team can access it." size="sm">
        <form onSubmit={submit} className="space-y-4">
          <Field label="File" hint="PDF, images, Office documents or text — max 10 MB.">
            {(p) => <input {...p} type="file" name="file" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm" />}
          </Field>
          <Field label="Category">
            {(p) => (
              <Select {...p} name="category" defaultValue="OTHER">
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {internal && <Checkbox name="visibleToClient" defaultChecked label="Visible to the client" />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "doc"}>
              Upload
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ProjectEditor({ orgs, staff, project }: { orgs: { id: string; name: string }[]; staff: { id: string; name: string }[]; project?: { id: string; organizationId: string; name: string; description?: string; status: string; startDate?: string; dueDate?: string; assignedStaff: string[] } }) {
  const { pending, errors, run, router } = useRun();
  const [open, setOpen] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      organizationId: fd.get("organizationId"),
      name: fd.get("name"),
      description: fd.get("description") || undefined,
      status: fd.get("status"),
      startDate: fd.get("startDate") || undefined,
      dueDate: fd.get("dueDate") || undefined,
      assignedStaff: fd.getAll("assignedStaff"),
    };
    void run("proj", () => (project ? apiFetch(`/api/projects/${project.id}`, { method: "PATCH", body }) : apiFetch<{ _id: string }>("/api/projects", { body })), "Project saved").then((r) => {
      if (!r) return;
      setOpen(false);
      if (!project) router.push(`/dashboard/projects/${(r as { _id: string })._id}`);
    });
  }
  return (
    <>
      <Button size="sm" variant={project ? "outline" : "primary"} onClick={() => setOpen(true)}>
        {project ? "Edit project" : (<><Plus className="h-4 w-4" aria-hidden /> New project</>)}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={project ? "Edit project" : "New project"} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" error={errors.organizationId}>
              {(p) => (
                <Select {...p} name="organizationId" defaultValue={project?.organizationId} required>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} name="status" defaultValue={project?.status ?? "PLANNED"}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} name="name" defaultValue={project?.name} required />}
          </Field>
          <Field label="Description" optional="optional">
            {(p) => <Textarea {...p} name="description" rows={3} defaultValue={project?.description} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" optional="optional">
              {(p) => <Input {...p} type="date" name="startDate" defaultValue={project?.startDate?.slice(0, 10)} />}
            </Field>
            <Field label="Due date" optional="optional">
              {(p) => <Input {...p} type="date" name="dueDate" defaultValue={project?.dueDate?.slice(0, 10)} />}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Assigned staff</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {staff.map((s) => (
                <Checkbox key={s.id} name="assignedStaff" value={s.id} defaultChecked={project?.assignedStaff.includes(s.id)} label={s.name} />
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "proj"}>
              Save project
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function InquiryStatus({ id, status }: { id: string; status: string }) {
  const { run } = useRun();
  return (
    <Select defaultValue={status} aria-label="Enquiry status" className="w-36 text-xs" onChange={(e) => void run("inq", () => apiFetch(`/api/contact-requests/${id}`, { method: "PATCH", body: { status: e.target.value } }), "Status updated")}>
      {CONTACT_REQUEST_STATUSES.map((s) => (
        <option key={s} value={s}>
          {humanize(s)}
        </option>
      ))}
    </Select>
  );
}
