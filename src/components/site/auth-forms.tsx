"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { INDUSTRIES } from "@/config/industries";
import { LANGUAGES, localizedPath } from "@/config/languages";
import { apiFetch, ApiError } from "@/lib/api/client";
import { rememberAccount } from "./auth-button";
import { createTranslator, type Messages } from "@/lib/i18n/translator";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";

const COUNTRY_OPTIONS = ["NO", "SE", "DK", "FI", "DE", "FR", "GB", "NL", "BE", "AT", "CH", "IE", "PL", "ES", "IT", "PT", "IS", "EE", "CZ"];

function useFormState() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function run(fn: () => Promise<void>, fallback: string) {
    setPending(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors ?? {});
        setError(err.status === 401 || err.status === 429 || err.status === 400 ? err.message : fallback);
      } else setError(fallback);
    } finally {
      setPending(false);
    }
  }
  return { pending, error, fieldErrors, run };
}

export function LoginForm({ locale, messages, next }: { locale: string; messages: Messages; next?: string }) {
  const { t } = createTranslator(messages);
  const { pending, error, fieldErrors, run } = useFormState();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      const res = await apiFetch<{ redirect: string }>("/api/auth/login", { body: { email: fd.get("email"), password: fd.get("password"), next } });
      rememberAccount();
      window.location.assign(res.redirect);
    }, t("auth.login.invalid"));
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.email")} error={fieldErrors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}
      </Field>
      <Field label={t("auth.password")} error={fieldErrors.password}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <div className="flex justify-end">
        <Link href={localizedPath(locale, "/forgot-password")} className="text-sm font-medium text-brand-700 hover:text-brand-800">
          {t("auth.login.forgot")}
        </Link>
      </div>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {pending ? t("auth.login.submitting") : t("auth.login.submit")}
      </Button>
      <p className="text-center text-sm text-ink-500">
        {t("auth.login.noAccount")}{" "}
        <Link href={localizedPath(locale, "/signup")} className="font-medium text-brand-700 hover:text-brand-800">
          {t("auth.login.createAccount")}
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ locale, messages }: { locale: string; messages: Messages }) {
  const { t } = createTranslator(messages);
  const { pending, error, fieldErrors, run } = useFormState();
  const [done, setDone] = useState(false);
  const regionNames = new Intl.DisplayNames([locale === "no" ? "nb" : locale], { type: "region" });
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    run(async () => {
      await apiFetch("/api/auth/signup", { body });
      rememberAccount();
      setDone(true);
    }, t("contact.form.error"));
  }
  if (done) {
    return (
      <div className="text-center" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-ink-900">{t("auth.signup.successTitle")}</h2>
        <p className="mt-2 text-sm text-ink-600">{t("auth.signup.successText")}</p>
        <Link href={localizedPath(locale, "/login")} className="mt-6 inline-block text-sm font-medium text-brand-700">
          {t("auth.signup.signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.name")} error={fieldErrors.name}>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </Field>
      <Field label={t("auth.company")} error={fieldErrors.company}>
        {(p) => <Input {...p} name="company" autoComplete="organization" required />}
      </Field>
      <Field label={t("auth.email")} error={fieldErrors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field label={t("auth.password")} error={fieldErrors.password} hint={t("auth.signup.passwordHint")}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" minLength={10} required />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("auth.phone")} error={fieldErrors.phone} optional={t("contact.form.optional")}>
          {(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" />}
        </Field>
        <Field label={t("auth.country")} error={fieldErrors.country}>
          {(p) => (
            <Select {...p} name="country" required defaultValue="">
              <option value="" disabled>
                {t("contact.form.select")}
              </option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {regionNames.of(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t("auth.website")} error={fieldErrors.website} optional={t("contact.form.optional")}>
        {(p) => <Input {...p} name="website" inputMode="url" placeholder="example.com" />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("auth.industry")} error={fieldErrors.industry}>
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
        <Field label={t("auth.preferredLanguage")} error={fieldErrors.preferredLanguage}>
          {(p) => (
            <Select {...p} name="preferredLanguage" defaultValue={locale}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} lang={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="hidden" aria-hidden>
        <input name="website2" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {pending ? t("auth.signup.submitting") : t("auth.signup.submit")}
      </Button>
      <p className="text-center text-sm text-ink-500">
        {t("auth.signup.haveAccount")}{" "}
        <Link href={localizedPath(locale, "/login")} className="font-medium text-brand-700">
          {t("auth.signup.signIn")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ messages }: { messages: Messages }) {
  const { t } = createTranslator(messages);
  const { pending, error, fieldErrors, run } = useFormState();
  const [sent, setSent] = useState(false);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get("email");
    run(async () => {
      await apiFetch("/api/auth/forgot-password", { body: { email } });
      setSent(true);
    }, t("contact.form.error"));
  }
  if (sent) return <Alert tone="success">{t("auth.forgot.sent")}</Alert>;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.email")} error={fieldErrors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("auth.forgot.submit")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ locale, messages, token }: { locale: string; messages: Messages; token: string }) {
  const { t } = createTranslator(messages);
  const { pending, error, fieldErrors, run } = useFormState();
  const [done, setDone] = useState(false);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    run(async () => {
      await apiFetch("/api/auth/reset-password", { body: { token, password } });
      setDone(true);
    }, t("auth.reset.invalid"));
  }
  if (!token) return <Alert tone="danger">{t("auth.reset.invalid")}</Alert>;
  if (done)
    return (
      <Alert tone="success" title={t("auth.reset.success")}>
        <Link href={localizedPath(locale, "/login")} className="font-medium underline">
          {t("auth.login.submit")}
        </Link>
      </Alert>
    );
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.password")} error={fieldErrors.password} hint={t("auth.signup.passwordHint")}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" minLength={10} required />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}
