"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { PERMISSION_LABELS, PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, type Permission } from "@/lib/permissions";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

function PermissionChecklist({ selected, disabled }: { selected: string[]; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Permissions</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PERMISSIONS.map((p) => (
          <Checkbox key={p} name="permissions" value={p} defaultChecked={selected.includes(p)} label={<span><code className="text-xs text-ink-500">{p}</code><br />{PERMISSION_LABELS[p]}</span>} />
        ))}
      </div>
    </fieldset>
  );
}

export function CreateUserButton({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"STAFF" | "ADMIN">("STAFF");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const toast = useToast();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});
    try {
      await apiFetch("/api/admin/users", { body: { name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), role, permissions: fd.getAll("permissions") } });
      toast.success("User created");
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        toast.error(err.message);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> New user
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New internal user" size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name}>
              {(p) => <Input {...p} name="name" required />}
            </Field>
            <Field label="Email" error={errors.email}>
              {(p) => <Input {...p} name="email" type="email" required />}
            </Field>
            <Field label="Initial password" error={errors.password} hint="At least 10 characters. Ask them to change it on first login.">
              {(p) => <Input {...p} name="password" type="password" minLength={10} required />}
            </Field>
            <Field label="Role">
              {(p) => (
                <Select {...p} value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "ADMIN")}>
                  <option value="STAFF">Staff</option>
                  {isOwner && <option value="ADMIN">Admin</option>}
                </Select>
              )}
            </Field>
          </div>
          <PermissionChecklist key={role} selected={ROLE_DEFAULT_PERMISSIONS[role]} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Create user
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditUserButton({ user, isOwner, isSelf }: { user: { id: string; name: string; role: string; status: string; permissions: Permission[] }; isOwner: boolean; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const locked = (user.role === "OWNER" || user.role === "ADMIN") && !isOwner;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { permissions: fd.getAll("permissions") };
    if (!isSelf) {
      body.role = fd.get("role");
      body.status = fd.get("status");
    }
    if (user.role === "OWNER") delete body.permissions;
    setPending(true);
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body });
      toast.success("User updated — their sessions were refreshed");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }
  async function revoke() {
    try {
      await apiFetch(`/api/admin/users/${user.id}`, { body: {} });
      toast.success("All sessions revoked");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed");
    }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={locked} className="text-sm font-medium text-brand-700 disabled:cursor-not-allowed disabled:text-ink-300" title={locked ? "Only the owner can change admins" : undefined}>
        Manage
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Manage ${user.name}`} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role">
              {(p) => (
                <Select {...p} name="role" defaultValue={user.role} disabled={isSelf}>
                  <option value="STAFF">Staff</option>
                  <option value="ADMIN" disabled={!isOwner}>Admin</option>
                  <option value="OWNER" disabled={!isOwner}>Owner</option>
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} name="status" defaultValue={user.status} disabled={isSelf}>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              )}
            </Field>
          </div>
          {user.role === "OWNER" ? <p className="text-sm text-ink-500">Owners always have every permission.</p> : <PermissionChecklist selected={user.permissions} />}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => void revoke()}>
              Sign out everywhere
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        void apiFetch("/api/notifications", { body: {} }).then(() => router.refresh())
      }
    >
      Mark all as read
    </Button>
  );
}
