"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { INDUSTRIES, INDUSTRY_LABELS } from "@/config/industries";
import { SERVICE_ITEM_KEYS } from "@/config/services";
import { apiFetch, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

export type CaseStudyForm = {
  id?: string;
  slug: string;
  clientName: string;
  industry?: string;
  services: string[];
  technologies: string[];
  isExample: boolean;
  published: boolean;
  projectUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  content: { title: string; summary?: string; challenge?: string; solution?: string; results?: string[]; testimonial?: string };
};

/** Minimal case-study editor. Results must be real — or the entry must be marked as an example. */
export function CaseStudyEditor({ initial }: { initial?: CaseStudyForm }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const toast = useToast();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      slug: fd.get("slug"),
      clientName: fd.get("clientName"),
      industry: fd.get("industry") || undefined,
      services: fd.getAll("services"),
      technologies: String(fd.get("technologies") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      isExample: fd.get("isExample") === "on",
      published: fd.get("published") === "on",
      projectUrl: fd.get("projectUrl") ?? "",
      thumbnailUrl: fd.get("thumbnailUrl") ?? "",
      videoUrl: fd.get("videoUrl") ?? "",
      content: {
        title: fd.get("title"),
        summary: fd.get("summary") || undefined,
        challenge: fd.get("challenge") || undefined,
        solution: fd.get("solution") || undefined,
        results: String(fd.get("results") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        testimonial: fd.get("testimonial") || undefined,
      },
    };
    setPending(true);
    setErrors({});
    try {
      if (initial?.id) await apiFetch(`/api/case-studies/${initial.id}`, { method: "PATCH", body });
      else await apiFetch("/api/case-studies", { body });
      toast.success("Case study saved");
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
      {initial ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-brand-700">
          Edit
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> New case study
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={initial ? "Edit case study" : "New case study"} description="Never publish fabricated results. Illustrative content must be marked as an example." size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name" error={errors.clientName}>
              {(p) => <Input {...p} name="clientName" defaultValue={initial?.clientName} required />}
            </Field>
            <Field label="URL slug" error={errors.slug} hint="lowercase-with-dashes">
              {(p) => <Input {...p} name="slug" defaultValue={initial?.slug} required pattern="[a-z0-9-]{3,80}" />}
            </Field>
          </div>
          <Field label="Title" error={errors["content.title"]}>
            {(p) => <Input {...p} name="title" defaultValue={initial?.content.title} required />}
          </Field>
          <Field label="Summary" optional="optional">
            {(p) => <Textarea {...p} name="summary" rows={2} defaultValue={initial?.content.summary} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Challenge" optional="optional">
              {(p) => <Textarea {...p} name="challenge" rows={4} defaultValue={initial?.content.challenge} />}
            </Field>
            <Field label="Solution" optional="optional">
              {(p) => <Textarea {...p} name="solution" rows={4} defaultValue={initial?.content.solution} />}
            </Field>
          </div>
          <Field label="Results (one per line)" optional="optional" hint="Only verifiable outcomes.">
            {(p) => <Textarea {...p} name="results" rows={3} defaultValue={initial?.content.results?.join("\n")} />}
          </Field>
          <Field label="Testimonial" optional="optional" hint="Shown only for real (non-example) case studies, with the client's permission.">
            {(p) => <Textarea {...p} name="testimonial" rows={2} defaultValue={initial?.content.testimonial} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry" optional="optional">
              {(p) => (
                <Select {...p} name="industry" defaultValue={initial?.industry ?? ""}>
                  <option value="">—</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {INDUSTRY_LABELS[i]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Technologies (comma-separated)" optional="optional">
              {(p) => <Input {...p} name="technologies" defaultValue={initial?.technologies.join(", ")} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Project link" optional="optional" error={errors.projectUrl} hint="https://… (the live site)">
              {(p) => <Input {...p} name="projectUrl" type="url" defaultValue={initial?.projectUrl} placeholder="https://" />}
            </Field>
            <Field label="Thumbnail image" optional="optional" error={errors.thumbnailUrl} hint="https:// image URL">
              {(p) => <Input {...p} name="thumbnailUrl" type="url" defaultValue={initial?.thumbnailUrl} placeholder="https://" />}
            </Field>
            <Field label="Walkthrough video" optional="optional" error={errors.videoUrl} hint="YouTube, Vimeo or .mp4 / .webm">
              {(p) => <Input {...p} name="videoUrl" type="url" defaultValue={initial?.videoUrl} placeholder="https://" />}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Services</legend>
            <div className="scroll-thin grid max-h-40 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
              {SERVICE_ITEM_KEYS.map((s) => (
                <Checkbox key={s} name="services" value={s} defaultChecked={initial?.services.includes(s)} label={s.replace(/([A-Z])/g, " $1").toLowerCase()} />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-6">
            <Checkbox name="isExample" defaultChecked={initial?.isExample ?? true} label="Illustrative example (labelled publicly)" />
            <Checkbox name="published" defaultChecked={initial?.published ?? false} label="Published" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
