"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

export type HeaderAuthState = { kind: "unresolved" } | { kind: "signed-in"; home: string; name?: string; role?: string } | { kind: "signed-out" };
const AuthContext = createContext<HeaderAuthState>({ kind: "unresolved" });

/** One session lifecycle for both desktop and mobile controls. */
export function HeaderAuthProvider({ initialState, children }: { initialState: HeaderAuthState; children: ReactNode }) {
  const [updated, setUpdated] = useState<{ initial: HeaderAuthState; state: HeaderAuthState }>();
  const state = updated?.initial === initialState ? updated.state : initialState;
  useEffect(() => {
    let cancelled = false;
    let pending: AbortController | undefined;
    const refresh = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch("/api/auth/status", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result: { signedIn: boolean; home?: string; name?: string; role?: string } = await response.json();
        if (cancelled || controller.signal.aborted) return;
        if (result.signedIn && result.home) {
          rememberAccount();
          setUpdated({ initial: initialState, state: { kind: "signed-in", home: result.home, name: result.name, role: result.role } });
          void fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
        } else if (result.signedIn === false) setUpdated({ initial: initialState, state: { kind: "signed-out" } });
      } catch {
        // Network failures do not change the last validated session state.
      } finally {
        window.clearTimeout(timeout);
      }
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    // The server already resolved the session; no duplicate status request on mount.
    if (initialState.kind === "signed-in") {
      void fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    }
    window.addEventListener("auth-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      pending?.abort();
      window.removeEventListener("auth-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [initialState]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** Server-rendered auth control, shared across desktop and mobile navigation. */
export function AuthButton({ loginHref, loginLabel, className, onNavigate }: { loginHref: string; loginLabel: string; className?: string; onNavigate?: () => void }) {
  const state = useContext(AuthContext);
  const base = cn("inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors", className);
  if (state.kind === "unresolved") {
    return <span role="status" aria-live="polite" className={cn(base, "border border-ink-200 bg-white text-ink-800")}>Account<span className="sr-only"> status loading</span></span>;
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
  return <Link href={loginHref} onClick={onNavigate} className={cn(base, "border border-ink-200 bg-white text-ink-800 hover:bg-ink-50")}>{loginLabel}</Link>;
}
