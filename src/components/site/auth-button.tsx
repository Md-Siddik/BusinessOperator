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

type State = { kind: "loading" } | { kind: "signed-in"; home: string } | { kind: "returning" } | { kind: "new" };

/**
 * Header auth button:
 *  - signed in → "Login" opens the visitor's own area (owner dashboard, staff workspace or client portal)
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
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((s: { signedIn: boolean; home?: string }) => {
        if (cancelled) return;
        if (s.signedIn && s.home) {
          rememberAccount();
          setState({ kind: "signed-in", home: s.home });
        } else setState({ kind: known ? "returning" : "new" });
      })
      .catch(() => !cancelled && setState({ kind: known ? "returning" : "new" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const base = cn("inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors", className);
  if (state.kind === "loading") {
    // Reserve the space without flashing the wrong button.
    return (
      <span className={cn(base, "invisible border border-transparent")} aria-hidden>
        {loginLabel}
      </span>
    );
  }
  if (state.kind === "new") {
    return (
      <Link href={signupHref} onClick={onNavigate} className={cn(base, "border border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-ink-50")}>
        {signupLabel}
      </Link>
    );
  }
  const href = state.kind === "signed-in" ? state.home : loginHref;
  return (
    <Link href={href} onClick={onNavigate} className={cn(base, "border border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-ink-50")}>
      {loginLabel}
    </Link>
  );
}
