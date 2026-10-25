"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
export function AcceptInvitation({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending) return;
    const body = { ...Object.fromEntries(new FormData(e.currentTarget)), token };
    setPending(true); setError("");
    try { await apiFetch("/api/auth/invitation", { body }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to accept invitation."); }
    finally { setPending(false); }
  }
  if (done) return <div role="status" className="space-y-4"><p>Your password is set. Sign in with your email and password to continue.</p><Link href="/login" className="text-brand-700">Sign in</Link></div>;
  return <form onSubmit={submit} className="space-y-4"><h1 className="text-2xl font-semibold">Set up your account</h1>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <Field label="Full name">{(p) => <Input {...p} name="name" autoComplete="name" minLength={2} maxLength={120} required />}</Field>
    <Field label="Choose a password" hint="Use at least 10 characters.">{(p) => <Input {...p} name="password" type={show ? "text" : "password"} autoComplete="new-password" minLength={10} required />}</Field>
    <button type="button" aria-pressed={show} onClick={() => setShow(!show)} className="text-sm text-brand-700">{show ? "Hide password" : "Show password"}</button>
    <Button type="submit" loading={pending}>Set password</Button>
  </form>;
}
