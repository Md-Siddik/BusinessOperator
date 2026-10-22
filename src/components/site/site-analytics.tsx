"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

export type CookieConsentLabels = { title: string; text: string; accept: string; decline: string };

const CONSENT_COOKIE = "et_consent";
const CONSENT_MAX_AGE = 395 * 86_400;
/** Fired by the footer's "Cookie settings" link to reopen the banner. */
export const COOKIE_SETTINGS_EVENT = "et:cookie-settings";

type Choice = "granted" | "denied" | null;

function readChoice(): Choice {
  try {
    const m = /(?:^|;\s*)et_consent=(granted|denied)/.exec(document.cookie);
    return (m?.[1] as Choice) ?? null;
  } catch {
    return null;
  }
}

/** The cookie only changes through this component, which re-renders itself; nothing to subscribe to. */
const noSubscribe = () => () => {};

function writeChoice(choice: "granted" | "denied") {
  try {
    document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    /* storage blocked: the banner simply shows again next time */
  }
}

/** Fire-and-forget: analytics must never affect the page. */
async function post(url: string, body: unknown): Promise<{ id?: string } | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, credentials: "same-origin" });
    return res.ok ? ((await res.json().catch(() => null)) as { id?: string } | null) : null;
  } catch {
    return null;
  }
}

/**
 * Website analytics for the public site: a consent banner and a page-view beacon.
 * Before a choice (or after "Decline") page views are sent without any identifier; only
 * after "Accept" does the server set an anonymous visitor cookie. See docs/website-analytics.md.
 */
export function SiteAnalytics({ labels }: { labels: CookieConsentLabels }) {
  const pathname = usePathname();
  // The stored choice, read on the client only ("ssr" while server rendering, so the banner never flashes or mismatches).
  const stored = useSyncExternalStore(noSubscribe, readChoice, () => "ssr" as const);
  const [answered, setAnswered] = useState(false);
  const [reopened, setReopened] = useState(false);
  const open = !answered && (reopened || stored === null);
  const last = useRef<{ url: string; id?: string } | null>(null);
  // How this tab arrived on the site — kept in memory only, so an "Accept" keeps the visit's source.
  const landing = useRef<{ url: string; referrer: string } | null>(null);

  useEffect(() => {
    const reopen = () => {
      setAnswered(false);
      setReopened(true);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    const onHide = () => {
      if (document.visibilityState === "hidden" && readChoice() === "granted" && last.current) void post("/api/track", { type: "ping", url: last.current.url });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    const url = `${location.pathname}${location.search}`;
    if (last.current?.url === url) return; // one beacon per page (also under React strict mode)
    const referrer = last.current ? `${location.origin}${last.current.url}` : document.referrer;
    if (!landing.current) landing.current = { url, referrer };
    last.current = { url };
    const entry = last.current;
    void post("/api/track", { type: "pageview", url, referrer, webdriver: navigator.webdriver === true }).then((r) => {
      if (r?.id) entry.id = r.id;
    });
  }, [pathname]);

  function choose(choice: "granted" | "denied") {
    const before = readChoice();
    writeChoice(choice);
    setAnswered(true);
    setReopened(false);
    if (choice === "granted" && before !== "granted" && last.current) {
      // Re-record this page with consent (replacing its cookieless record), keeping how the visit arrived.
      void post("/api/track", { type: "pageview", url: last.current.url, referrer: document.referrer, replaces: last.current.id, landing: landing.current ?? undefined, webdriver: navigator.webdriver === true });
    }
    if (choice === "denied") void post("/api/track/consent", { granted: false });
  }

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="et-consent-title" className="fixed inset-x-4 bottom-4 z-[60] rounded-2xl border border-ink-200 bg-white p-5 shadow-lifted sm:left-6 sm:right-auto sm:bottom-6 sm:max-w-sm">
      <p id="et-consent-title" className="text-sm font-semibold text-ink-900">
        {labels.title}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{labels.text}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => choose("denied")} className="h-10 rounded-lg border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50">
          {labels.decline}
        </button>
        <button type="button" onClick={() => choose("granted")} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          {labels.accept}
        </button>
      </div>
    </div>
  );
}

/** Footer link that reopens the consent banner. */
export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))} className="hover:text-white">
      {label}
    </button>
  );
}
