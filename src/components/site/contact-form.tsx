"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
import { SERVICE_ITEM_KEYS } from "@/config/services";
import { INDUSTRIES } from "@/config/industries";
import { apiFetch, ApiError } from "@/lib/api/client";
import { createTranslator, type Messages } from "@/lib/i18n/translator";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";

const NEEDS = ["website", "ongoing", "systems", "growth", "recruitment", "automation", "notSure"] as const;
const BUDGETS = ["small", "medium", "large", "monthly", "unknown"] as const;
const COUNTRY_OPTIONS = ["NO", "SE", "DK", "FI", "DE", "FR", "GB", "NL", "BE", "AT", "CH", "IE", "PL", "ES", "IT", "PT", "IS", "EE", "LV", "LT", "CZ", "US"];
/** Mirrors ENGAGEMENT_MODELS in features/content/service.ts (server-only module). */
const ENGAGEMENTS = ["monthly", "growth", "project", "notSure"] as const;

/** Preselects the engagement model from ?engagement=… (engagement detail pages link here). */
function EngagementFromUrl({ onChange }: { onChange: (value: string) => void }) {
  const value = useSearchParams().get("engagement");
  useEffect(() => {
    if (value && (ENGAGEMENTS as readonly string[]).includes(value)) onChange(value);
  }, [value, onChange]);
  return null;
}

export function ContactForm({ locale, messages }: { locale: string; messages: Messages }) {
  const { t } = createTranslator(messages);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [engagement, setEngagement] = useState("");
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames([locale === "no" ? "nb" : locale], { type: "region" }) : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError(undefined);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    const body = {
      ...Object.fromEntries([...fd.entries()].filter(([k]) => k !== "interestedServices")),
      interestedServices: fd.getAll("interestedServices"),
      locale,
    };
    try {
      await apiFetch("/api/contact", { body });
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(err instanceof ApiError && err.status === 429 ? err.message : t("contact.form.error"));
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-ink-900">{t("contact.form.successTitle")}</h2>
        <p className="mt-2 text-ink-600">{t("contact.form.successText")}</p>
      </div>
    );
  }

  const opt = t("contact.form.optional");
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("contact.form.name")} error={fieldErrors.name}>
          {(p) => <Input {...p} name="name" autoComplete="name" required />}
        </Field>
        <Field label={t("contact.form.company")} error={fieldErrors.company}>
          {(p) => <Input {...p} name="company" autoComplete="organization" />}
        </Field>
        <Field label={t("contact.form.email")} error={fieldErrors.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field label={t("contact.form.phone")} error={fieldErrors.phone} optional={opt}>
          {(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" />}
        </Field>
        <Field label={t("contact.form.country")} error={fieldErrors.country}>
          {(p) => (
            <Select {...p} name="country" defaultValue="">
              <option value="">{t("contact.form.select")}</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {regionNames?.of(c) ?? c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("contact.form.industry")} error={fieldErrors.industry}>
          {(p) => (
            <Select {...p} name="industry" defaultValue="">
              <option value="">{t("contact.form.select")}</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {t(`industries.${i}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("contact.form.website")} error={fieldErrors.website} optional={opt}>
          {(p) => <Input {...p} name="website" inputMode="url" placeholder="example.com" />}
        </Field>
        <Field label={t("contact.form.need")} error={fieldErrors.need}>
          {(p) => (
            <Select {...p} name="need" defaultValue="">
              <option value="">{t("contact.form.select")}</option>
              {NEEDS.map((n) => (
                <option key={n} value={n}>
                  {t(`contact.form.needs.${n}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("contact.form.engagement")} error={fieldErrors.engagement} optional={opt} className="sm:col-span-2">
          {(p) => (
            <Select {...p} name="engagement" value={engagement} onChange={(e) => setEngagement(e.target.value)}>
              <option value="">{t("contact.form.select")}</option>
              {ENGAGEMENTS.map((m) => (
                <option key={m} value={m}>
                  {t(`contact.form.engagements.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Suspense fallback={null}>
        <EngagementFromUrl onChange={setEngagement} />
      </Suspense>
      <Field label={t("contact.form.message")} error={fieldErrors.message}>
        {(p) => <Textarea {...p} name="message" rows={5} required />}
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-800">{t("contact.form.preferredContact")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["email", "phone", "video"] as const).map((m, i) => (
            <label key={m} className="cursor-pointer">
              <input type="radio" name="preferredContact" value={m} defaultChecked={i === 0} className="peer sr-only" />
              <span className="inline-flex rounded-full border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300">
                {t(`contact.form.contactMethods.${m}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <details className="group rounded-2xl border border-ink-200 bg-ink-50/50 px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-800">
          {t("contact.form.budget")} · {t("contact.form.ongoingSupport")} · {t("contact.form.interestedServices")} <span className="font-normal text-ink-400">({opt})</span>
        </summary>
        <div className="mt-5 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("contact.form.budget")} optional={opt}>
              {(p) => (
                <Select {...p} name="budget" defaultValue="">
                  <option value="">{t("contact.form.select")}</option>
                  {BUDGETS.map((b) => (
                    <option key={b} value={b}>
                      {t(`contact.form.budgets.${b}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("contact.form.ongoingSupport")} optional={opt}>
              {(p) => (
                <Select {...p} name="ongoingSupport" defaultValue="">
                  <option value="">{t("contact.form.select")}</option>
                  <option value="yes">{t("contact.form.yes")}</option>
                  <option value="maybe">{t("contact.form.maybe")}</option>
                  <option value="no">{t("contact.form.no")}</option>
                </Select>
              )}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-800">{t("contact.form.interestedServices")}</legend>
            <div className="scroll-thin grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {SERVICE_ITEM_KEYS.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-700 hover:bg-white">
                  <input type="checkbox" name="interestedServices" value={s} className="h-4 w-4 accent-brand-600" />
                  {t(`serviceItems.${s}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      {/* Honeypot: hidden from people and assistive tech */}
      <div className="hidden" aria-hidden>
        <label>
          Website 2 <input name="website2" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <p className="text-xs text-ink-500">{t("contact.form.privacy")}</p>
        <Button type="submit" size="lg" loading={status === "sending"}>
          {status === "sending" ? t("contact.form.sending") : t("contact.form.submit")}
          {status !== "sending" && <Send className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </form>
  );
}
