"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { localizedPath } from "@/config/languages";
import { apiFetch, ApiError } from "@/lib/api/client";
import { rememberAccount } from "./auth-button";
import { createTranslator, type Messages } from "@/lib/i18n/translator";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";

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
  const [showPassword, setShowPassword] = useState(false);
  const [verification, setVerification] = useState<{ email: string; challenge?: string }>();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      const res = await apiFetch<{ redirect?: string; verificationRequired?: boolean; email?: string; challenge?: string }>("/api/auth/login", { body: { email: fd.get("email"), password: fd.get("password"), next } });
      rememberAccount();
      if (res.verificationRequired) { setVerification({ email: String(res.email), challenge: res.challenge }); return; }
      window.location.assign(res.redirect || "/portal");
    }, t("auth.login.invalid"));
  }
  if (verification) return <VerificationForm {...verification} next={next} onComplete={(redirect) => window.location.assign(redirect)} />;
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.email")} error={fieldErrors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}
      </Field>
      <Field label={t("auth.password")} error={fieldErrors.password}>
        {(p) => <Input {...p} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />}
      </Field>
      <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="text-sm text-brand-700">{showPassword ? "Hide password" : "Show password"}</button>
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
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    run(async () => {
      await apiFetch("/api/auth/signup", { body });
      setEmail(String(body.email));
      rememberAccount();
      setDone(true);
    }, t("contact.form.error"));
  }
  if (done) return <VerificationForm email={email} onComplete={(redirect) => window.location.assign(redirect)} />;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={t("auth.name")} error={fieldErrors.name}>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </Field>
      <Field label={t("auth.email")} error={fieldErrors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field label={t("auth.password")} error={fieldErrors.password} hint={t("auth.signup.passwordHint")}>
        {(p) => <Input {...p} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} required />}
      </Field>
      <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="text-sm text-brand-700">{showPassword ? "Hide password" : "Show password"}</button>
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
  const [showPassword, setShowPassword] = useState(false);
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
        {(p) => <Input {...p} name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} required />}
      </Field>
      <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)} className="text-sm text-brand-700">{showPassword ? "Hide password" : "Show password"}</button>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}

export function VerificationForm({ email, challenge, next, onComplete }: { email: string; challenge?: string; next?: string; onComplete: (redirect: string) => void }) {
  const { pending, error, run } = useFormState();
  const [notice, setNotice] = useState("If eligible, check your email for a code. If none arrives, request a new code. Codes expire after 10 minutes and allow five attempts.");
  return <form className="space-y-4" onSubmit={(e) => {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code");
    void run(async () => {
      const result = await apiFetch<{ redirect: string }>("/api/auth/verify", { body: { email, code, challenge, next } });
      rememberAccount();
      window.dispatchEvent(new Event("auth-changed"));
      onComplete(result.redirect);
    }, "Verification failed. Please retry.");
  }}>
    <p role="status" className="text-sm text-ink-600">{notice}</p>
    {error && <Alert tone="danger">{error}</Alert>}
    <Field label="Security code">{(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />}</Field>
    <Button type="submit" loading={pending}>Verify and continue</Button>
    <Button type="button" disabled={pending} onClick={() => void run(async () => {
      await apiFetch("/api/auth/resend", { body: { email, challenge } });
      setNotice("If eligible, a new code was requested. Wait at least 60 seconds before retrying.");
    }, "Unable to request a code.")}>Resend code</Button>
  </form>;
}
