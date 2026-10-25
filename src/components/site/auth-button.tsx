"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Set after a login or signup on this browser — marks a returning visitor. */
export const HAS_ACCOUNT_KEY = "et_has_account";

export function rememberAccount() {
  try {
    localStorage.setItem(HAS_ACCOUNT_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

type State = { kind: "loading" } | { kind: "signed-in"; home: string; name?: string; role?: string } | { kind: "returning" } | { kind: "new" };

/**
 * Header auth button:
 *  - signed in → profile menu opens the visitor's own area (owner dashboard, staff workspace or client portal)
 *  - returning visitor (has logged in / signed up on this browser) → "Login"
 *  - new visitor → "Sign up"
 */
export function AuthButton({ loginHref, signupHref, loginLabel, signupLabel, className, onNavigate }: { loginHref: string; signupHref: string; loginLabel: string; signupLabel: string; className?: string; onNavigate?: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const known = (() => {
      try {
        return localStorage.getItem(HAS_ACCOUNT_KEY) === "1";
      } catch {
        return false;
      }
    })();
    const refresh = () => fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((s: { signedIn: boolean; home?: string; name?: string; role?: string }) => {
        if (cancelled) return;
        if (s.signedIn && s.home) {
          void fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
          rememberAccount();
          setState({ kind: "signed-in", home: s.home, name: s.name, role: s.role });
        } else setState({ kind: known ? "returning" : "new" });
      })
      .catch(() => !cancelled && setState({ kind: known ? "returning" : "new" }));
    void refresh();
    window.addEventListener("auth-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("auth-changed", refresh);
      window.removeEventListener("focus", refresh);
      cancelled = true;
    };
  }, []);

  const base = cn("inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors", className);
  if (state.kind === "loading") {
    // Reserve the space without flashing the wrong button.
    return (
      <span className={cn(base, "animate-pulse border border-ink-200 bg-ink-100 text-transparent")} aria-hidden>
        {loginLabel}
      </span>
    );
  }
  if (state.kind === "signed-in") return (
    <details className="relative">
      <summary aria-label="User profile menu" className={cn(base, "cursor-pointer list-none border border-ink-200 bg-white text-ink-800")}>
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-800">{state.name?.charAt(0).toUpperCase() || "U"}</span>
        <span className="sr-only">{state.name || "My account"}</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 grid min-w-44 gap-1 rounded-xl border border-ink-200 bg-white p-2 text-sm text-ink-800 shadow-lg">
        <Link className="rounded p-2 hover:bg-ink-50" href={state.home} onClick={onNavigate}>My Dashboard</Link>
        <Link className="rounded p-2 hover:bg-ink-50" href={state.role === "CLIENT" ? "/portal/profile" : state.home + "/settings/security"} onClick={onNavigate}>My Profile</Link>
        <Link className="rounded p-2 hover:bg-ink-50" href={state.home + "/messages"} onClick={onNavigate}>Messages</Link>
        {state.role === "CLIENT" && <Link className="rounded p-2 hover:bg-ink-50" href="/portal/inquiries" onClick={onNavigate}>My Inquiries</Link>}
        <button type="button" className="rounded p-2 text-left hover:bg-ink-50" onClick={async () => {
          const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
          if (response.ok) { window.dispatchEvent(new Event("auth-changed")); window.location.reload(); }
        }}>Logout</button>
      </div>
    </details>
  );
  return <Link href={state.kind === "new" ? signupHref : loginHref} onClick={onNavigate} className={cn(base, "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50")}>{state.kind === "new" ? signupLabel : loginLabel}</Link>;
}
