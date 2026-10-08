"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { SERVICE_CATEGORIES } from "@/config/services";
import { LANGUAGES } from "@/config/languages";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

export function RequestServiceButton({ labels }: { labels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    try {
      await apiFetch("/api/services/request", { body: { category: fd.get("category"), notes: fd.get("notes") || undefined } });
      toast.success("Request sent — we'll be in touch");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Request a service
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Request a service" size="sm">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Service area">
            {(p) => (
              <Select {...p} name="category">
                {SERVICE_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {labels[c.slug] ?? c.slug}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="What do you need?" optional="optional">
            {(p) => <Textarea {...p} name="notes" rows={4} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Send request
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function OrganizationProfileForm({ org }: { org: { id: string; name: string; website?: string; phone?: string; address?: string; preferredLanguage: string } }) {
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const toast = useToast();
  const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});
    try {
      await apiFetch(`/api/clients/${org.id}`, { method: "PATCH", body: Object.fromEntries(fd.entries()) });
      toast.success("Company profile saved");
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
    <form onSubmit={submit} className="space-y-4">
      <Field label="Company name" error={errors.name}>{(p) => <Input {...p} name="name" defaultValue={org.name} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Website" error={errors.website}>{(p) => <Input {...p} name="website" defaultValue={org.website} />}</Field>
        <Field label="Phone" error={errors.phone}>{(p) => <Input {...p} name="phone" defaultValue={org.phone} />}</Field>
      </div>
      <Field label="Address">{(p) => <Input {...p} name="address" defaultValue={org.address} />}</Field>
      <Field label="Preferred language">
        {(p) => (
          <Select {...p} name="preferredLanguage" defaultValue={org.preferredLanguage}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" loading={pending}>
        Save company profile
      </Button>
    </form>
  );
}
