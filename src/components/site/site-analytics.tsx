"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, consentFromCookieHeader, createConsent, serializeConsent, type ConsentRecord, type ConsentStatus } from "@/lib/consent";

export type CookieConsentLabels = { title: string; text: string; essential: string; accept: string; decline: string };

/** Fired by the footer's "Cookie settings" link to reopen the consent dialog. */
export const COOKIE_SETTINGS_EVENT = "et:cookie-settings";
/** Fired after a decision is saved, so every reader of the cookie re-renders. */
const CONSENT_CHANGED_EVENT = "et:consent-changed";

function readConsent(): ConsentRecord | null {
  try {
    return consentFromCookieHeader(document.cookie);
  } catch {
    return null;
  }
}

/** Serialised snapshot for useSyncExternalStore (must be stable between calls). */
const snapshot = () => {
  const r = readConsent();
  return r ? `${r.status}.${r.at}` : "none";
};
function subscribe(cb: () => void) {
  window.addEventListener(CONSENT_CHANGED_EVENT, cb);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, cb);
}

function writeConsent(status: ConsentStatus) {
  try {
    const value = serializeConsent(createConsent(status));
    document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    /* storage blocked: the dialog simply asks again next time, and nothing optional runs */
  }
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

/** The browser's time zone (e.g. "Europe/Oslo"), so a visit can be shown in the visitor's local time. */
function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** One random id per beacon: the server counts a retried request once. */
function eventId() {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Fire-and-forget: analytics must never affect the page. */
function post(url: string, body: unknown) {
  try {
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/**
 * Dialog state. With no valid decision (first visit, an older policy version, or an expired
 * decision) the dialog is open and blocking: it can only be closed with Accept or Deny. Reopened
 * from "Cookie settings" while a valid decision exists, it may be dismissed (keeping that decision).
 */
export function consentDialogState(stored: "ssr" | "none" | string, reopened: boolean) {
  if (stored === "ssr") return { open: false, blocking: false };
  const pending = stored === "none";
  return { open: pending || reopened, blocking: pending };
}

/** Focus trap: the element that Tab / Shift+Tab moves to from `index` among `count` focusable elements. */
export function nextFocusIndex(index: number, count: number, shift: boolean) {
  if (count <= 0) return -1;
  if (index < 0) return shift ? count - 1 : 0;
  return shift ? (index - 1 + count) % count : (index + 1) % count;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Website analytics for the public site: a centred, blocking consent dialog and a page-view
 * beacon. Nothing optional runs before a valid decision: no beacon, no visitor cookie. After
 * "Accept" page views are recorded with an anonymous visitor cookie; "Deny" records nothing and
 * deletes anything recorded earlier for this browser. See docs/website-analytics.md.
 */
export function SiteAnalytics({ labels }: { labels: CookieConsentLabels }) {
  const pathname = usePathname();
  // Read on the client only ("ssr" while server rendering, so the dialog never mismatches hydration).
  const stored = useSyncExternalStore(subscribe, snapshot, () => "ssr");
  const granted = stored.startsWith("granted.");
  const [reopened, setReopened] = useState(false);
  const { open, blocking } = consentDialogState(stored, reopened);
  const last = useRef<string | null>(null);
  // How this tab arrived on the site — kept in memory only, so an "Accept" keeps the visit's source.
  const landing = useRef<{ url: string; referrer: string } | null>(null);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    const onHide = () => {
      if (document.visibilityState === "hidden" && readConsent()?.status === "granted" && last.current) post("/api/track", { type: "ping", url: last.current });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    const url = `${location.pathname}${location.search}`;
    if (!landing.current) landing.current = { url, referrer: document.referrer };
    if (previous.current === url) return; // one beacon per page (also under React strict mode)
    const referrer = previous.current ? `${location.origin}${previous.current}` : document.referrer;
    previous.current = url;
    // Optional analytics only with a valid "granted" decision.
    if (readConsent()?.status !== "granted") return;
    last.current = url;
    post("/api/track", { type: "pageview", url, referrer, tz: timeZone(), webdriver: navigator.webdriver === true, eventId: eventId() });
  }, [pathname]);

  function choose(status: ConsentStatus) {
    const before = readConsent()?.status;
    writeConsent(status);
    setReopened(false);
    if (status === "granted" && before !== "granted") {
      // Record the page the visitor is on now, keeping how this tab arrived.
      const url = `${location.pathname}${location.search}`;
      last.current = url;
      post("/api/track", { type: "pageview", url, referrer: document.referrer, landing: landing.current ?? undefined, tz: timeZone(), webdriver: navigator.webdriver === true, eventId: eventId() });
    }
    // Deny (or a change to Deny): delete anything recorded for this browser and its visitor cookie.
    if (status === "denied") post("/api/track/consent", { granted: false });
  }

  if (!open) return null;
  return <ConsentDialog labels={labels} blocking={blocking} current={granted ? "granted" : stored === "none" ? null : "denied"} onChoose={choose} onDismiss={() => setReopened(false)} />;
}

/**
 * Modal consent dialog (native <dialog>.showModal(): the rest of the page is inert — no clicks,
 * focus or keyboard reach it — and focus is kept inside). Centred on every screen size; the page
 * behind does not scroll while it is open.
 */
export function ConsentDialog({ labels, blocking, current, onChoose, onDismiss }: { labels: CookieConsentLabels; blocking: boolean; current: ConsentStatus | null; onChoose: (s: ConsentStatus) => void; onDismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    // Focus the first choice (Deny) so keyboard users start inside the dialog.
    d.querySelector<HTMLElement>("[data-consent-first]")?.focus();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
      if (d.open && typeof d.close === "function") d.close();
    };
  }, []);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const next = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    items[next]!.focus();
  }

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="et-consent-title"
      aria-describedby="et-consent-text"
      onKeyDown={onKeyDown}
      // Escape: never bypasses the choice. Without a valid decision it does nothing; when reopened
      // from Cookie settings it closes and keeps the decision already saved.
      onCancel={(e) => {
        e.preventDefault();
        if (!blocking) onDismiss();
      }}
      className="fixed inset-0 z-[70] m-auto h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-ink-200 bg-white p-6 text-ink-900 shadow-lifted backdrop:bg-ink-950/60 backdrop:backdrop-blur-[2px] sm:p-7"
    >
      <h2 id="et-consent-title" className="text-lg font-semibold text-ink-900">
        {labels.title}
      </h2>
      <div id="et-consent-text" className="mt-2 space-y-2 text-sm leading-relaxed text-ink-600">
        <p>{labels.text}</p>
        <p className="text-ink-500">{labels.essential}</p>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          data-consent-first
          aria-pressed={current === "denied" || undefined}
          onClick={() => onChoose("denied")}
          className="h-11 rounded-lg border border-ink-300 bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {labels.decline}
        </button>
        <button
          type="button"
          aria-pressed={current === "granted" || undefined}
          onClick={() => onChoose("granted")}
          className="h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {labels.accept}
        </button>
      </div>
    </dialog>
  );
}

/** Footer link that reopens the consent dialog. */
export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))} className="hover:text-white">
      {label}
    </button>
  );
}
