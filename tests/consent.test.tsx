import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CONSENT_MAX_AGE_SECONDS, CONSENT_VERSION, consentFromCookieHeader, createConsent, hasAnalyticsConsent, parseConsent, serializeConsent } from "@/lib/consent";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const { ConsentDialog, SiteAnalytics, consentDialogState, nextFocusIndex } = await import("@/components/site/site-analytics");

/**
 * Requirement 2: centred, blocking cookie consent. The consent record (version, timestamp,
 * categories), the dialog's state machine, keyboard handling and markup. Server-side refusal
 * of analytics without consent is covered in website-analytics.test.ts.
 */
const NOW = Date.parse("2026-10-28T12:00:00Z");
const labels = { title: "Analytics cookies", text: "May we use an anonymous analytics cookie?", essential: "Essential cookies are always on.", accept: "Accept", decline: "Deny" };

describe("Consent record", () => {
  it("stores the decision with policy version, timestamp and categories", () => {
    const g = createConsent("granted", NOW);
    expect(g).toEqual({ status: "granted", version: CONSENT_VERSION, at: NOW / 1000, categories: ["essential", "analytics"] });
    expect(serializeConsent(g)).toBe(`granted.${CONSENT_VERSION}.${NOW / 1000}.essential+analytics`);
    expect(createConsent("denied", NOW).categories).toEqual(["essential"]);
    expect(parseConsent(serializeConsent(g), NOW)).toEqual(g);
  });

  it("only a valid, current 'granted' decision allows analytics; Deny never does", () => {
    expect(hasAnalyticsConsent(serializeConsent(createConsent("granted", NOW)), NOW)).toBe(true);
    expect(hasAnalyticsConsent(serializeConsent(createConsent("denied", NOW)), NOW)).toBe(false);
    expect(hasAnalyticsConsent(undefined, NOW)).toBe(false);
  });

  it("asks again when the decision is invalid, from an older policy version, expired or tampered with", () => {
    const at = NOW / 1000;
    const invalid = [
      "granted", // the pre-2026-10 value (no version or timestamp)
      "denied",
      `granted.1.${at}.essential+analytics`, // older policy version
      `granted.${CONSENT_VERSION}.${at - CONSENT_MAX_AGE_SECONDS - 1}.essential+analytics`, // expired
      `granted.${CONSENT_VERSION}.${at + 86_400}.essential+analytics`, // dated in the future
      `granted.${CONSENT_VERSION}.${at}.essential`, // categories don't match the decision
      `denied.${CONSENT_VERSION}.${at}.essential+analytics`, // Deny can't carry analytics
      `granted.${CONSENT_VERSION}.${at}.essential+analytics+ads`, // unknown category
      "garbage",
    ];
    for (const v of invalid) expect(parseConsent(v, NOW)).toBeNull();
  });

  it("reads the decision from a cookie header", () => {
    const v = serializeConsent(createConsent("denied", NOW));
    expect(consentFromCookieHeader(`a=1; et_consent=${v}; b=2`, NOW)?.status).toBe("denied");
    expect(consentFromCookieHeader("a=1", NOW)).toBeNull();
  });
});

describe("Consent dialog behaviour", () => {
  it("is open and blocking without a valid decision; not shown when one is saved; dismissible only when reopened", () => {
    expect(consentDialogState("ssr", false)).toEqual({ open: false, blocking: false });
    expect(consentDialogState("none", false)).toEqual({ open: true, blocking: true });
    expect(consentDialogState("none", true)).toEqual({ open: true, blocking: true });
    // A saved decision is not prompted again…
    expect(consentDialogState(`granted.${NOW / 1000}`, false)).toEqual({ open: false, blocking: false });
    expect(consentDialogState(`denied.${NOW / 1000}`, false)).toEqual({ open: false, blocking: false });
    // …but Cookie settings reopens it, and then Escape may close it (keeping the saved decision).
    expect(consentDialogState(`denied.${NOW / 1000}`, true)).toEqual({ open: true, blocking: false });
  });

  it("traps keyboard focus: Tab and Shift+Tab cycle inside the dialog", () => {
    expect(nextFocusIndex(0, 2, false)).toBe(1);
    expect(nextFocusIndex(1, 2, false)).toBe(0);
    expect(nextFocusIndex(0, 2, true)).toBe(1);
    expect(nextFocusIndex(-1, 2, false)).toBe(0); // focus outside → back to the first control
    expect(nextFocusIndex(-1, 2, true)).toBe(1);
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });

  it("renders an accessible modal dialog with clear Accept and Deny buttons", () => {
    const html = renderToStaticMarkup(<ConsentDialog labels={labels} blocking current={null} onChoose={() => {}} onDismiss={() => {}} />);
    expect(html).toMatch(/^<dialog/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="et-consent-title"');
    expect(html).toContain('aria-describedby="et-consent-text"');
    expect(html).toContain('id="et-consent-title"');
    expect(html).toContain(">Accept</button>");
    expect(html).toContain(">Deny</button>");
    expect(html).toContain("Essential cookies are always on.");
    // Centred in the viewport on every screen size, with an overlay behind it.
    expect(html).toContain("fixed inset-0");
    expect(html).toContain("m-auto");
    expect(html).toContain("backdrop:bg-ink-950/60");
    expect(html).toContain("w-[calc(100%-2rem)]");
  });

  it("marks the saved choice when reopened from Cookie settings", () => {
    const html = renderToStaticMarkup(<ConsentDialog labels={labels} blocking={false} current="denied" onChoose={() => {}} onDismiss={() => {}} />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Deny<\/button>/);
  });

  it("renders nothing on the server (no flash, no hydration mismatch) and sends no beacon there", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(renderToStaticMarkup(<SiteAnalytics labels={labels} />)).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
