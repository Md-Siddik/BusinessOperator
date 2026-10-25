"use client";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { VerificationForm } from "./auth-forms";
import { rememberAccount } from "./auth-button";

export function QuickAuth({ onComplete }: { onComplete: () => void }) {
  const [signup, setSignup] = useState(false);
  const [verification, setVerification] = useState<{ email: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  function complete() { rememberAccount(); window.dispatchEvent(new Event("auth-changed")); onComplete(); }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setPending(true); setError("");
    try {
      const result = await apiFetch<{ registrationRequired?: boolean }>(signup ? "/api/auth/signup" : "/api/auth/login", { body });
      if (signup || result.registrationRequired) setVerification({ email: String(body.email) });
      else complete();
    } catch (err) { setError(err instanceof Error ? err.message : "Please retry."); }
    finally { setPending(false); }
  }
  if (verification) return <VerificationForm {...verification} onComplete={complete} />;
  return <form onSubmit={submit} className="space-y-3">
    <p className="font-semibold">{signup ? "Create your account" : "Sign in to chat"}</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {signup && <Field label="Full name">{(p) => <Input {...p} name="name" autoComplete="name" minLength={2} required />}</Field>}
    <Field label="Email address">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
    <Field label="Password">{(p) => <Input {...p} name="password" type={show ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 10 : 1} required />}</Field>
    <button type="button" aria-pressed={show} className="text-xs text-brand-700" onClick={() => setShow(!show)}>{show ? "Hide password" : "Show password"}</button>
    <div className="hidden" aria-hidden><input name="website2" tabIndex={-1} autoComplete="off" /></div>
    <Button type="submit" loading={pending}>{signup ? "Create account" : "Sign in"}</Button>
    <button type="button" className="block text-sm text-brand-700" onClick={() => { setSignup(!signup); setError(""); }}>{signup ? "Already registered? Sign in" : "New here? Create account"}</button>
  </form>;
}
